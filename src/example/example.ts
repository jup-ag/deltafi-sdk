import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { exit } from "process";
import { createSwapTransaction } from "./client";
import {
  getDeploymentConfig,
  getOrCreateAssociatedAccountInfo,
  getPoolConfig,
  getTokenConfig,
  readKeypair,
} from "./utils";
import { Command } from "commander";
import * as https from "https";
import { getSwapOutResult } from "../calculations/swapOutAmount";

// the example transaction logic
// this function established 2 transaction, first sell USDC for USDT and second sell USDT for USDC
// because we have to wallet keypair in code base, we just sign the transaction generated by the API
// directly with the wallet keypair
// in actually application, we should use wallet sdk for the signature
const runExample = async (keypairFilePath: string, network: string) => {
  if (network !== "testnet" && network !== "mainnet-beta") {
    console.error("wrong network!");
    exit(1);
  }

  const deployConfig = getDeploymentConfig(network === "mainnet-beta" ? "mainnet-prod" : "testnet");
  const poolConfig = getPoolConfig(deployConfig, "USDC-USDT");
  console.info("pool config:", poolConfig);

  const usdcTokenConfig = getTokenConfig(deployConfig, "USDC");
  const usdtTokenConfig = getTokenConfig(deployConfig, "USDT");

  const keyPair = readKeypair(keypairFilePath);
  const connection = new Connection(clusterApiUrl(deployConfig.network), "confirmed");

  // get USDC/USDT token account from the wallet
  const usdcTokenAccount = (
    await getOrCreateAssociatedAccountInfo(
      connection,
      keyPair,
      new PublicKey(usdcTokenConfig.mint),
      keyPair.publicKey,
    )
  ).address;
  const usdtTokenAccount = (
    await getOrCreateAssociatedAccountInfo(
      connection,
      keyPair,
      new PublicKey(usdtTokenConfig.mint),
      keyPair.publicKey,
    )
  ).address;

  const swapoutResult = await getSwapOutResult(
    new PublicKey(usdcTokenConfig.mint),
    new PublicKey(usdtTokenConfig.mint),
    "1",
    0.01,
    connection,
    deployConfig);
  console.info(swapoutResult);

  // example transaction 1: sell USDC for USDT
  console.info("transaction 1: sell 1 USDC for USDT");
  const { transaction: transactionUSDCforUSDT, userTransferAuthority: tmpAuthorityA } =
    await createSwapTransaction(
      keyPair.publicKey,
      connection,
      usdcTokenAccount,
      usdtTokenAccount,
      "1",
      swapoutResult.amountOutWithSlippage,
      deployConfig,
      poolConfig,
      usdcTokenConfig,
      usdtTokenConfig,
    );

  try {
    // may use wallet sdk for signature in application
    const signature = await sendAndConfirmTransaction(connection, transactionUSDCforUSDT, [
      tmpAuthorityA,
      keyPair,
    ]);
    console.info("transaction USDC -> USDT succeeded with signature: " + signature);
  } catch (e) {
    console.error("transaction USDC -> USDT failed with error: " + e);
    exit(1);
  }

  // example transaction 2: sell USDT for USDC
  console.info("transaction 2: sell 1 USDT for USDC");
  const swapoutResult2 = await getSwapOutResult(
    new PublicKey(usdtTokenConfig.mint),
    new PublicKey(usdcTokenConfig.mint),
    "1",
    0.01,
    connection,
    deployConfig);
  console.info(swapoutResult2);

  const { transaction: transactionUSDTforUSDC, userTransferAuthority: tmpAuthorityB } =
    await createSwapTransaction(
      keyPair.publicKey,
      connection,
      usdtTokenAccount,
      usdcTokenAccount,
      "1",
      swapoutResult2.amountOutWithSlippage,
      deployConfig,
      poolConfig,
      usdtTokenConfig,
      usdcTokenConfig,
    );

  try {
    // may use wallet sdk for signature in application
    const signature = await sendAndConfirmTransaction(connection, transactionUSDTforUSDC, [
      tmpAuthorityB,
      keyPair,
    ]);
    console.info("transaction USDT -> USDC succeeded with signature: " + signature);
  } catch (e) {
    console.error("transaction USDT -> USDC failed with error: " + e);
    exit(1);
  }
};

const getConfig = async () => {
  const options = {
    hostname: "app.deltafi.trade",
    port: 443,
    path: "/api/config",
    method: "GET",
  };

  const req = https.request(options, (res) => {
    res.on("data", (data) => {
      // pretty print the config json
      console.log(JSON.stringify(JSON.parse(Buffer.from(data).toString()), null, 2));
    });
  });

  req.on("error", (error) => {
    console.error(error);
  });

  req.end();
};

const main = () => {
  const program = new Command();
  program
    .command("run")
    .option("-k --keypair <wallet keypair for example transactions>")
    .option("-n --network <mainnet-beta or testnet>")
    .action(async (option) => {
      runExample(option.keypair, option.network);
    });

  program.command("get-config").action(getConfig);

  program.parse(process.argv);
};

main();
