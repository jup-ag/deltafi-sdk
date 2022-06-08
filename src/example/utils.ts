import { Connection, PublicKey, Transaction, Keypair, Signer } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import fullDeployConfigV2 from "../anchor/fullDeployConfigV2.json";
import * as fs from "fs";
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";

export function getDeploymentConfig(deployment: string) {
  const deploymentConfig = fullDeployConfigV2[deployment];
  if (!deploymentConfig) {
    throw Error("Invalid deployment: " + deployment);
  }
  return deploymentConfig;
}

export function getPoolConfig(deployConfig, poolName) {
  return deployConfig.poolInfoList.find(({ name }) => poolName === name);
}

export function getTokenConfig(deployConfig, tokenSymbol) {
  return deployConfig.tokenInfoList.find(({ symbol }) => symbol === tokenSymbol);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function mergeTransactions(transactions: (Transaction | undefined)[]) {
  const transaction = new Transaction();
  transactions
    .filter((t): t is Transaction => !!t)
    .forEach((t) => {
      transaction.add(t);
    });
  return transaction;
}

export function exponentiate(num: BigNumber | string, decimals: number): BigNumber {
  return new BigNumber(num).multipliedBy(new BigNumber(`1e+${decimals}`));
}

export const readKeypair = (path: string) => {
  const secret = JSON.parse(fs.readFileSync(path).toString());
  return Keypair.fromSecretKey(Uint8Array.from(secret));
};

export async function getOrCreateAssociatedAccountInfo(
  connection: Connection,
  signer: Signer,
  mint: PublicKey,
  owner: PublicKey,
) {
  const lpToken = new Token(connection, mint, TOKEN_PROGRAM_ID, signer);
  return lpToken.getOrCreateAssociatedAccountInfo(owner);
}
