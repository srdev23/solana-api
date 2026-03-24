import * as web3 from "@solana/web3.js";
import { connection } from "../config";
function readBytes(buf: Buffer, offset: number, length: number): Buffer {
  const end = offset + length;
  if (buf.byteLength < end) throw new RangeError("range out of bounds");
  return buf.subarray(offset, end);
}

function readBigUintLE(buf: Buffer, offset: number, length: number): bigint {
  switch (length) {
    case 1: return BigInt(buf.readUint8(offset));
    case 2: return BigInt(buf.readUint16LE(offset));
    case 4: return BigInt(buf.readUint32LE(offset));
    case 8: return buf.readBigUint64LE(offset);
  }
  throw new Error(`unsupported data size (${length} bytes)`);
}

function readBoolean(buf: Buffer, offset: number, length: number): boolean {
  const data = readBytes(buf, offset, length);
  for (const b of data) {
    if (b) return true;
  }
  return false;
}


const PUMP_CURVE_TOKEN_DECIMALS = 6;

// Calculated as the first 8 bytes of: `sha256("account:BondingCurve")`.
const PUMP_CURVE_STATE_SIGNATURE = Uint8Array.from([0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60]);

const PUMP_CURVE_STATE_SIZE = 0x29;
const PUMP_CURVE_STATE_OFFSETS = {
  VIRTUAL_TOKEN_RESERVES: 0x08,
  VIRTUAL_SOL_RESERVES: 0x10,
  REAL_TOKEN_RESERVES: 0x18,
  REAL_SOL_RESERVES: 0x20,
  TOKEN_TOTAL_SUPPLY: 0x28,
  COMPLETE: 0x30,
};

interface PumpCurveState {
  virtualTokenReserves: bigint
  virtualSolReserves: bigint
  realTokenReserves: bigint
  realSolReserves: bigint
  tokenTotalSupply: bigint
  complete: boolean
}

// Fetches account data of a Pump.fun bonding curve, and deserializes it
// according to `accounts.BondingCurve` (see: Pump.fun program's Anchor IDL).
async function getPumpCurveState(conn: web3.Connection, curveAddress: web3.PublicKey): Promise<PumpCurveState| null> {
  const response = await conn.getAccountInfo(curveAddress);
  if (!response || !response.data || response.data.byteLength < PUMP_CURVE_STATE_SIGNATURE.byteLength + PUMP_CURVE_STATE_SIZE) {
    return null;
    throw new Error(`unexpected curve state${curveAddress.toString()}`);
  }

  const idlSignature = readBytes(response.data, 0, PUMP_CURVE_STATE_SIGNATURE.byteLength);
  if (idlSignature.compare(PUMP_CURVE_STATE_SIGNATURE) !== 0) {
    return null;
    throw new Error(`unexpected curve state IDL signature ${curveAddress.toString()}`);
  }

  return {
    virtualTokenReserves: readBigUintLE(response.data, PUMP_CURVE_STATE_OFFSETS.VIRTUAL_TOKEN_RESERVES, 8),
    virtualSolReserves: readBigUintLE(response.data, PUMP_CURVE_STATE_OFFSETS.VIRTUAL_SOL_RESERVES, 8),
    realTokenReserves: readBigUintLE(response.data, PUMP_CURVE_STATE_OFFSETS.REAL_TOKEN_RESERVES, 8),
    realSolReserves: readBigUintLE(response.data, PUMP_CURVE_STATE_OFFSETS.REAL_SOL_RESERVES, 8),
    tokenTotalSupply: readBigUintLE(response.data, PUMP_CURVE_STATE_OFFSETS.TOKEN_TOTAL_SUPPLY, 8),
    complete: readBoolean(response.data, PUMP_CURVE_STATE_OFFSETS.COMPLETE, 1),
  };
}

// Calculates token price (in SOL) of a Pump.fun bonding curve.
function calculatePumpCurvePrice(curveState: PumpCurveState): number|null {
  if (curveState === null || typeof curveState !== "object"
    || !(typeof curveState.virtualTokenReserves === "bigint" && typeof curveState.virtualSolReserves === "bigint")) {
      return null;
    throw new TypeError("curveState must be a PumpCurveState");
  }

  if (curveState.virtualTokenReserves <= BigInt(0) || curveState.virtualSolReserves <= BigInt(0)) {
    return null;
    throw new RangeError("curve state contains invalid reserve data");
  }
  return (Number(curveState.virtualSolReserves) / web3.LAMPORTS_PER_SOL) / (Number(curveState.virtualTokenReserves) / 10 ** PUMP_CURVE_TOKEN_DECIMALS);
}

export const getPumpTokenPriceInSol = async (curve: string) => {
  const curveAddress = new web3.PublicKey(curve);
  const curveState = await getPumpCurveState(connection, curveAddress);
  if (!curveState) 
    return null;
  const tokenPriceSol = calculatePumpCurvePrice(curveState);
  return tokenPriceSol;
}
