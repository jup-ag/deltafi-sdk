import { token } from "@project-serum/anchor/dist/cjs/utils";
import { Token, TOKEN_PROGRAM_ID, u64 } from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import { DeltafiUser, SwapInfo, SwapDirection } from "./type_definitions";
import { toBufferLE } from "bigint-buffer";
import { BN } from "@project-serum/anchor";

export function mergeTransactions(transactions: (Transaction | undefined)[]) {
  const transaction = new Transaction();
  transactions
    .filter((t): t is Transaction => !!t)
    .forEach((t) => {
      transaction.add(t);
    });
  return transaction;
}

export async function getDeltafiUser(program, marketConfig, walletPubkey) {
  const [deltafiUserPubkey] = await PublicKey.findProgramAddress(
    [Buffer.from("User"), marketConfig.toBuffer(), walletPubkey.toBuffer()],
    program.programId,
  );
  return program.account.deltafiUser.fetchNullable(deltafiUserPubkey);
}

export async function createSwapTransaction(
  poolConfig: any,
  program: any,
  swapInfo: SwapInfo,
  deltafiUser: DeltafiUser,
  walletPubkey: PublicKey,
  inputTokenPubkey: PublicKey,
  outputTokenPubkey: PublicKey,
  inputAmount: BN,
  minOutputAmount: BN,
  swapDirection: SwapDirection,
): Promise<any> {
  const poolPubkey = new PublicKey(poolConfig.swapInfo);
  const marketConfig = swapInfo.configKey;

  const userTransferAuthority = Keypair.generate();
  const transactionApprove: Transaction = new Transaction();
  transactionApprove.add(
    Token.createApproveInstruction(
      TOKEN_PROGRAM_ID,
      inputTokenPubkey,
      userTransferAuthority.publicKey,
      walletPubkey,
      [],
      u64.fromBuffer(toBufferLE(BigInt(inputAmount.toString()), 8)),
    ),
  );

  const [deltafiUserPubkey, deltafiUserBump] = await PublicKey.findProgramAddress(
    [Buffer.from("User"), marketConfig.toBuffer(), walletPubkey.toBuffer()],
    program.programId,
  );

  const transactionCreateDeltafiUser: Transaction | undefined = (() => {
    if (!deltafiUser) {
      return program.transaction.createDeltafiUser(deltafiUserBump, {
        accounts: {
          marketConfig,
          owner: walletPubkey,
          deltafiUser: deltafiUserPubkey,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        },
      });
    }
  })();

  const { swapSourceToken, swapDestinationToken, adminDestinationToken } = (() => {
    if (swapDirection.sellBase) {
      return {
        swapSourceToken: swapInfo.tokenBase,
        swapDestinationToken: swapInfo.tokenQuote,
        adminDestinationToken: swapInfo.adminFeeTokenQuote,
      };
    } else if (swapDirection.sellQuote) {
      return {
        swapSourceToken: swapInfo.tokenQuote,
        swapDestinationToken: swapInfo.tokenBase,
        adminDestinationToken: swapInfo.adminFeeTokenBase,
      };
    }

    throw Error("Invalid swap direction: " + swapDirection);
  })();

  const swapAccounts = {
    marketConfig: marketConfig,
    swapInfo: poolPubkey,
    userSourceToken: inputTokenPubkey,
    userDestinationToken: outputTokenPubkey,
    swapSourceToken,
    swapDestinationToken,
    deltafiUser: deltafiUserPubkey,
    adminDestinationToken,
    pythPriceBase: swapInfo.pythPriceBase,
    pythPriceQuote: swapInfo.pythPriceQuote,
    userAuthority: userTransferAuthority.publicKey,
    tokenProgram: token.TOKEN_PROGRAM_ID,
  };

  const transactionSwap: Transaction = (() => {
    if (swapInfo.swapType.normalSwap) {
      return program.transaction.normalSwap(inputAmount, minOutputAmount, {
        accounts: swapAccounts,
      });
    } else if (swapInfo.swapType.stableSwap) {
      return program.transaction.stableSwap(inputAmount, minOutputAmount, {
        accounts: swapAccounts,
      });
    }

    throw Error("Invalid swap type: " + swapInfo.swapType);
  })();

  const transaction = mergeTransactions([
    transactionApprove,
    transactionCreateDeltafiUser,
    transactionSwap,
  ]);

  const signers = [userTransferAuthority];

  return { transaction, signers };
}
