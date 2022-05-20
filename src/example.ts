import { Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { exit } from "process";
import { createSwapTransaction } from "./client";
import { getConnection } from "./utils";

const exampleDeployment = "testnet";

const exampleKeyPair = Keypair.fromSecretKey(
  Uint8Array.from([
    213, 125, 55, 246, 235, 165, 230, 97, 173, 235, 79, 26, 171, 231, 156, 144, 82, 29, 86, 100, 41,
    137, 100, 52, 12, 207, 55, 183, 70, 150, 163, 145, 119, 185, 161, 160, 111, 85, 138, 184, 202,
    112, 148, 93, 161, 250, 124, 70, 132, 205, 255, 150, 83, 16, 90, 16, 51, 25, 180, 6, 255, 193,
    199, 66,
  ]),
);

const exampleUSDCMint = new PublicKey("3itb8x9GX7bxQ6eFfQT3E7CstkjaESizBpHNWB5wxjYY");
const exampleUSDTMint = new PublicKey("Hi4jco598zF6g4VM3uYfDaTvZFoMtX6TaTZZ9QdiVLUq");

const exampleUSDCTokenAccount = new PublicKey("J9ZWtE2vrSvEqLYsW3yEzAGSMvw2tFiVBNteQ6e565zy");
const exampleUSDTTokenAccount = new PublicKey("G5JJmV4qAtEE2dDJABn4iZ2W4RhdNM3xCDHw5SP1pafK");

const exampleTransactions = async () => {
  // example transaction 1: sell USDC for USDT
  const exampleConnection = getConnection(exampleDeployment);
  const { transaction: transactionUSDCforUSDT, userTransferAuthority: tmpAuthorityA } =
    await createSwapTransaction(
      exampleKeyPair.publicKey,
      exampleConnection,
      exampleUSDCMint,
      exampleUSDTMint,
      exampleUSDCTokenAccount,
      exampleUSDTTokenAccount,
      "12.3",
      "10",
      exampleDeployment,
    );

  try {
    const signature = await sendAndConfirmTransaction(exampleConnection, transactionUSDCforUSDT, [
      tmpAuthorityA,
      exampleKeyPair,
    ]);
    console.info("transaction USDC -> USDT succeeded with signature: " + signature);
  } catch (e) {
    console.error("transaction USDC -> USDT failed with error: " + e);
    exit(1);
  }

  // example transaction 2: sell USDT for USDC
  const { transaction: transactionUSDTforUSDC, userTransferAuthority: tmpAuthorityB } =
    await createSwapTransaction(
      exampleKeyPair.publicKey,
      exampleConnection,
      exampleUSDTMint,
      exampleUSDCMint,
      exampleUSDTTokenAccount,
      exampleUSDCTokenAccount,
      "15.3",
      "10",
      exampleDeployment,
    );

  try {
    const signature = await sendAndConfirmTransaction(exampleConnection, transactionUSDTforUSDC, [
      tmpAuthorityB,
      exampleKeyPair,
    ]);
    console.info("transaction USDT -> USDC succeeded with signature: " + signature);
  } catch (e) {
    console.error("transaction USDT -> USDC failed with error: " + e);
    exit(1);
  }
};

exampleTransactions();
