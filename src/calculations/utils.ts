import { PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import { SwapDirection } from "../anchor/type_definitions";
import { TokenConfig } from "./types";

export const WAD_LENGTH = 18;
export const WAD = new BigNumber(`1e+${WAD_LENGTH}`);

export function BigNumberWithConfig(
  val: number | BigNumber | string,
  object: BigNumber.Config,
): BigNumber {
  const BN = BigNumber.clone(object);
  return new BN(val);
}

export function validate(expression: boolean, errMsg: string) {
  if (expression === false) {
    throw Error(errMsg);
  }
}

const ClonedBignumber = BigNumber.clone({
  FORMAT: {
    decimalSeparator: ".",
    groupSeparator: ",",
    groupSize: 3,
  },
});
export function exponentiatedBy(num: BigNumber | string, decimals: number): BigNumber {
  const wrap = new ClonedBignumber(num);
  return wrap.div(new ClonedBignumber(`1e+${decimals}`));
}

export function exponentiate(num: BigNumber | string, decimals: number): BigNumber {
  return new BigNumber(num).multipliedBy(new BigNumber(`1e+${decimals}`));
}

export function getTokenConfigByMint(deploymentConfig, tokenMint: PublicKey): TokenConfig {
  const tokenConfigList: TokenConfig[] = deploymentConfig.tokenInfoList;
  return tokenConfigList?.find(
    (tokenConfig: TokenConfig) => tokenConfig.mint === tokenMint.toBase58(),
  );
}

export function getPoolAddressByTokens(
  deploymentConfig,
  tokenConfigA: TokenConfig,
  tokenConfigB: TokenConfig,
): PublicKey {
  const poolInfo = deploymentConfig.poolInfoList?.find(
    (pool) =>
      (pool.base === tokenConfigA.symbol && pool.quote === tokenConfigB.symbol) ||
      (pool.base === tokenConfigB.symbol && pool.quote === tokenConfigA.symbol),
  );
  return poolInfo ? new PublicKey(poolInfo.swapInfo) : null;
}

export function getPriceImpactDisplay(priceImpactBN: BigNumber): string {
  if (priceImpactBN.isLessThan(new BigNumber("0.001"))) {
    return "<0.1%";
  }
  return priceImpactBN.multipliedBy(100).toFixed(1) + "%";
}

// get the opposite swap direction from the current swap direction
export function getOppsiteSwapDirection(swapDirection: SwapDirection): SwapDirection {
  if (swapDirection.sellBase) {
    return { sellQuote: {} };
  } else if (swapDirection.sellQuote) {
    return { sellBase: {} };
  } else {
    throw Error("Invalid swapDirection: " + swapDirection);
  }
}
