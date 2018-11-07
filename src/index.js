const CONST = require('./constants');
const RomUtils = require('./romUtils');
const MemUtils = require('./memUtils');
const SaveLoadUtils = require('./slUtils');

const KeyUtils = require('./keypressUtils');
const { CB, didHalfCarry } = require('./CBOps');
const {
  State,
  u16,
  signed8,
  u16Tou8,
} = require('./state');

const { err, log } = require('./logger');

const ROM_FILE = './roms/DMG_ROM.bin';

const keyPressed = [null, true];
KeyUtils.handleKeyPress(keyPressed);

const memory = RomUtils.loadRom(ROM_FILE);

const CELA_TABLE = {
  4: 'C',
  5: 'E',
  6: 'L',
  7: 'A',
};

const BC_DE_HL_TABLE = {
  0: 'BC',
  1: 'DE',
  2: 'HL',
  3: 'AF',
};

const BCDEHLA_TABLE = {
  0x04: 'B',
  0x0C: 'C',
  0x14: 'D',
  0x1C: 'E',
  0x24: 'H',
  0x2C: 'L',
  0x3C: 'A',
};

const RST_ADDRESS = {
  0xC7: 0x00,
  0xD7: 0x10,
  0xE7: 0x20,
  0xF7: 0x30,
  0xCF: 0x08,
  0xDF: 0x18,
  0xEF: 0x28,
  0xFF: 0x38,
};

const systemState = new State();

const gameloop = state => {
  const {
    PC,
    setSP,
    addSP,
    addPC,
    setPC,
    xor,
  } = state;
  const opCode = memory[PC];
  log(`PC: 0x${PC.toString(16).padStart(4, 0)} OPCODE: ${opCode.toString(16)}`);
  switch (opCode) {
    // Stack Push/pop
    case 0xC5: // PUSH BC
    case 0xD5: // PUSH DE
    case 0xE5: // PUSH HL
    case 0xF5: // PUSH AF
      {
        const r16 = BC_DE_HL_TABLE[(opCode >> 4) - 0xC];
        const [H, L] = u16Tou8(state.getRegister(r16));
        addSP(-2);
        memory[state.SP - 1] = H;
        memory[state.SP - 2] = L;
        addPC(1);
      }
      break;

    case 0xC1: // POP BC
    case 0xD1: // POP DE
    case 0xE1: // POP HL
    case 0xF1: // POP AF
      {
        const r16 = BC_DE_HL_TABLE[(opCode >> 4) - 0xC];
        const H = memory[state.SP - 1];
        const L = memory[state.SP - 2];
        addSP(2);
        const HL = u16Tou8(H, L);
        state.setRegister(r16, HL);
        addPC(1);
      }
      break;


      // LD r8(CELA), A
    case 0x4F: // LD C, A
    case 0x5F: // LD E, A
    case 0x6F: // LD L, A
    case 0x7F: // LD A, A
      {
        const r8 = CELA_TABLE[opCode >> 4];
        state.setRegister(r8, state.A);
        addPC(1);
      }
      break;

    case 0x08: // LD (nn), SP
      {
        const [H, L] = u16Tou8(state.SP);
        memory[state.PC + 2] = H;
        memory[state.PC + 1] = L;
        addPC(3);
      }
      break;

      // INC
    case 0x04: // B
    case 0x0C: // C
    case 0x14: // D
    case 0x1C: // E
    case 0x24: // H
    case 0x2C: // L
    case 0x3C: // A
      {
        const register = BCDEHLA_TABLE[opCode];
        const v = state.getRegister(register) + 1;

        state.setFlag('Z', !v);
        state.setFlag('N', 0);
        state.setFlag('H', didHalfCarry(v, state.getRegister(register)));
        state.setRegister(register, v);

        addPC(1);
      }
      break;
      // DEC
    case 0x05: // B
    case 0x0D: // C
    case 0x15: // D
    case 0x1D: // E
    case 0x25: // H
    case 0x2D: // L
    case 0x3D: // A
      {
        const register = BCDEHLA_TABLE[opCode - 1];
        const v = state.getRegister(register) - 1;

        state.setFlag('Z', !v);
        state.setFlag('N', 1);
        state.setFlag('H', didHalfCarry(v, state.getRegister(register)));
        state.setRegister(register, v);

        addPC(1);
      }
      break;

      // LD R, n
    case 0x06: // LD B, n
    case 0x0e: // LD C, n
    case 0x16: // LD D, n
    case 0x1e: // LD E, n
    case 0x26: // LD H, n
    case 0x2e: // LD L, n
    case 0x3e: // LD A, n
      {
        const n = memory[PC + 1];
        const register = BCDEHLA_TABLE[opCode - 2];
        state.setRegister(register, n);
        addPC(2);
      }
      break;
    case 0x36: // LD (HL), n
      {
        const n = memory[PC + 1];
        const HL = state.getRegister('HL');
        memory[HL] = n;
        addPC(2);
      }
      break;

      // LD R16, nn
    case 0x01: // LD BC, nn
    case 0x11: // LD DE, nn
    case 0x21: // LD HL, nn
      {
        const r16 = BC_DE_HL_TABLE[opCode >> 4]; // check UU
        const nn = u16(memory[PC + 2], memory[PC + 1]);
        state.setRegister(r16, nn);
        addPC(3);
      }
      break;

    case 0x31: // LD SP, nn
      setSP(u16(memory[PC + 2], memory[PC + 1]));
      addPC(3);
      break;

    case 0x1a: // LD A, (BC)
    case 0x2a: // LD A, (DE)
      {
        const r16 = BC_DE_HL_TABLE[opCode >> 4]; // check UU
        state.setRegister('A', memory[r16]);
        addPC(1);
      }
      break;

    case 0x20: // JR NZ, r
    case 0xC2:
    case 0xCA:
    case 0x28:
    case 0x30:
    case 0xD2:
    case 0x38:
    case 0xDA:
      {
        const r = signed8(memory[PC + 1]);
        log('JR NZ, r');
        log('R', r.toString(16), PC.toString(16), memory[PC + 1].toString(16));
        if (state.readFByOpCode(opCode)) {
          log('JR NZ WILL JUMP');
          addPC(r);
        }
        addPC(2);
      }
      break;

    case 0x22: // LD [HL+], A
    case 0x32: // LD [HL-], A
      {
        let HL = state.getRegister('HL');
        memory[HL] = state.A;
        HL += opCode === 0x22 ? 1 : -1;
        state.setRegister('HL', HL);
        log('LD [HL+-]', HL);
        addPC(1);
      }
      break;
    case 0x23: // INC HL
      {
        const HL = u16(state.H, state.L) + 1;
        state.setRegister('HL', HL);
        addPC(1);
      }
      break;

    case 0x77: // LD (HL),A
      {
        const HL = state.getRegister('HL');
        memory[HL] = state.A;
      }
      addPC(1);
      break;
    case 0xAF:
      xor('A', state.A);
      log('XOR A with A');
      addPC(1);
      break;

    case 0xC7: // RST
    case 0xD7:
    case 0xE7:
    case 0xF7:
    case 0xCF:
    case 0xDF:
    case 0xEF:
    case 0xFF:
      {
        const [H, L] = u16Tou8(PC);
        addSP(-2);
        memory[state.SP - 1] = H;
        memory[state.SP - 2] = L;
        setPC(RST_ADDRESS[opCode]);
      }
      break;

      // Special LD
    case 0xE0: // LDH (n), A i.e, // LD (0xFF00 + n), A
      {
        const n = memory[PC + 1];
        memory[0xFF00 + n] = state.A;
        addPC(2);
      }
      break;
    case 0xF0: // LDH A,(n) i.e, // LD A, (0xFF00 + n)
      {
        const n = memory[PC + 1];
        state.A = memory[0xFF00 + n];
        addPC(2);
      }
      break;
    case 0xE2: // LD (0xFF00 + C), A
      memory[0xFF00 + state.C] = state.A;
      addPC(1);
      break;
    case 0xF2: // LD  A, (0xFF00 + C)
      state.A = memory[0xFF00 + state.C];
      addPC(1);
      break;


    case 0xCB: // Bit Operations
      CB(memory[PC + 1], state);
      addPC(2);
      break;

    case 0x17: // RLA
      {
        const C = Number((state.A & 0x80) === 0x80);
        state.setRegister('A', (state.A << 1) | state.readF('C'));
        state.setFlag('Z', 0);
        state.setFlag('N', 0);
        state.setFlag('H', 0);
        state.setFlag('C', C);

        addPC(1);
      }
      break;

    case 0xCD: // Call nn
      {
        const nn = u16(memory[PC + 2], memory[PC + 1]);
        const [H, L] = u16Tou8(PC);
        addSP(-2);
        memory[state.SP - 1] = H;
        memory[state.SP - 2] = L;
        setPC(nn);
      }
      break;

    default:
      err('\n\nUnhandled OpCode:', opCode.toString(16));
      throw new Error();
  }
};

const stepper = async state => {
  while (!keyPressed[0]) {
    await new Promise(p => setTimeout(p, 100)); // eslint-disable-line
  }
  keyPressed[0] = null;
  log('State', state.toString());
};

let delay = 1;
let cycles = 0;
const FREQ = 4 * 1000 * 1000;
const M_SECOND = 1;
const SECOND = M_SECOND * 1000;

const M_FREQ = FREQ / SECOND;

let start = new Date().getTime();
const main = async () => {
  SaveLoadUtils.load('1541412273794.log', memory, systemState);
  while (keyPressed[1]) {
    cycles += 1;

    // This is pause is required to allow keyboard event loop to have a chance of executing
    // However, this will add an additional ~16ms of delay per pause
    if (cycles % M_FREQ === 0) {
      const now = new Date().getTime();
      // 8 MHZ
      delay = M_SECOND - (now - start);
      err('Delay value', delay);

      // setTimeout will cause the process to skip
      await new Promise(p => setTimeout(p, delay)); // eslint-disable-line
      start = now;
    }

    gameloop(systemState);
    // await stepper(systemState);
  }
  log('\n\nHalted:', systemState.toString());
};

main()
  .catch(e => {
    err('### Crashed ##');
    err('\n\nSTATE DUMP:', systemState.toString());
    err(e);
    const fName = `${new Date().getTime()}.log`;
    // SaveLoadUtils.save(fName, memory, systemState);
  })
  .finally(() => {
    console.log('Ended');
    process.exit();
  });
