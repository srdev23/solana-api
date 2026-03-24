import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
dotenv.config();

export const BLOXROUT_RECEIVER = new PublicKey('HWEoBxYs7ssKuudEjzjmpfJVX7Dvi7wescFsVx2L5yoY');
export const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
export const connection = new Connection(RPC_URL, 'confirmed');

const FEE_RECEIVER_ADDRESS = process.env.FEE_RECEIVER_ADDRESS;
export const SYS_FEE_RECEIVER = new PublicKey(FEE_RECEIVER_ADDRESS);
export const SYS_FEE = Number(process.env.SYSTEM_FEE); // Retrieve system fee from .env
export const AUTH_HEADER = process.env.AUTH_HEADER||'';

export const PORT = process.env.PORT || 3000;