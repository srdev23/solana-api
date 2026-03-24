import { bs58 } from "@project-serum/anchor/dist/cjs/utils/bytes/index.js";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import fs from "fs";
import { connection } from "./config";
import { JitoAccounts, JitoBundleService } from "./jito";

const payer = Keypair.fromSecretKey(
  Uint8Array.from(bs58.decode(process.env.PAYER_KEY || ""))
);

(async () => {
  let wallets = {};
  let transferInstructions: TransactionInstruction[] = [];
  const sTxns: any = [];
//   const numerOfWallets = 30
  const recentBlockhash = (await connection.getLatestBlockhash())
  .blockhash;

  wallets = JSON.parse(fs.readFileSync('./result.json', 'utf-8'));

    // Get only public keys (values) from the wallet object
    const publicKeys = Object.values(wallets);

console.log('Public Keys:', publicKeys);
//   for (let i = 0; i < numerOfWallets; i++) {
  for (let i = 0; i < publicKeys.length; i++) {
    // const keypair = Keypair.generate();
    // const wallet = keypair.publicKey;
    const wallet = new PublicKey(publicKeys[i] as string);
    // const pk = bs58.encode(keypair.secretKey);
    // wallets = {
    //   ...wallets,
    //   [pk]: wallet.toBase58(),
    // };

    const transferIxs = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: wallet,

      lamports: 0.001 * LAMPORTS_PER_SOL,
    });
    transferInstructions.push(transferIxs);
    if(i%10 === 0 || i === publicKeys.length - 1){
        if(i === publicKeys.length - 1){
            transferInstructions.push(
                SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: new PublicKey(JitoAccounts[0]),
                    lamports: 0.00001 * LAMPORTS_PER_SOL,
                })
            )
        }
        const messageV0 = new TransactionMessage({
            payerKey: payer.publicKey,
            recentBlockhash,
            instructions: transferInstructions,
          }).compileToV0Message();
          const vTxn = new VersionedTransaction(messageV0);
          const res = await connection.simulateTransaction(vTxn);
        if (res.value.err) {
            console.log(res.value.logs);
            return [];
        }
        vTxn.sign([payer]);
        sTxns.push(vTxn.serialize());
        transferInstructions = [];
    }
  }

  const jitoInstance = new JitoBundleService();
  const bundleid = await jitoInstance.sendBundle(sTxns);
//   const result = await jitoInstance.getBundleStatus(bundleid);
//   if(!result)
//   {
//     console.log("Failed to send bundle");
//     return;
//   }

//   fs.writeFileSync(`./result.json`, JSON.stringify(wallets, null, 2));
})();
