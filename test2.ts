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
  const numerOfWallets = 40
  const recentBlockhash = (await connection.getLatestBlockhash())
  .blockhash;

  wallets = JSON.parse(fs.readFileSync('./result.json', 'utf-8'));

    // Get only public keys (values) from the wallet object
    const privatekeys = Object.keys(wallets);

console.log('Public Keys:', privatekeys);
const keypairs = privatekeys.map(pk => Keypair.fromSecretKey(bs58.decode(pk)));
keypairs.forEach(key => console.log(key.publicKey.toBase58()));
//   for (let i = 0; i < numerOfWallets; i++) {
  for (let i = 0; i < privatekeys.length; i++) {
    const keypair = Keypair.fromSecretKey(bs58.decode(privatekeys[i]));
    // const keypair = Keypair.generate();
    // const wallet = keypair.publicKey;
    // const wallet = new PublicKey(publicKeys[i] as string);
    // const pk = bs58.encode(keypair.secretKey);
    // wallets = {
    //   ...wallets,
    //   [pk]: wallet.toBase58(),
    // };

    const transferIxs = SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: payer.publicKey,
      lamports: 0.004 * LAMPORTS_PER_SOL,
    });
    transferInstructions.push(transferIxs);
    if(i === privatekeys.length - 1){
        if(i === privatekeys.length - 1){
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
        //   vTxn.sign([payer]);
          if(i === privatekeys.length - 1)
            vTxn.sign([...keypairs, payer])
          else
            vTxn.sign(keypairs);


          sTxns.push(vTxn.serialize());
          transferInstructions = [];
    }
  }

  const jitoInstance = new JitoBundleService();
  const bundleid = await jitoInstance.sendBundle(sTxns);
  const result = await jitoInstance.getBundleStatus(bundleid);
  if(!result)
  {
    console.log("Failed to send bundle");
    return;
  }

//   fs.writeFileSync(`./result.json`, JSON.stringify(wallets, null, 2));
})();
