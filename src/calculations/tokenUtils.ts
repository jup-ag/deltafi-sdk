import { BN } from "@project-serum/anchor";
import BigNumber from "bignumber.js";
import { TokenConfig } from "./types";
import { exponentiate, exponentiatedBy } from "./utils";

export function bnToString(tokenConfig: TokenConfig, amount: BigNumber): string {
  return amount.toFixed(tokenConfig.decimals);
}

export function bnToAnchorBn(tokenConfig: TokenConfig, amount: BigNumber): BN {
  return new BN(exponentiate(amount, tokenConfig.decimals).toFixed(0));
}

export function anchorBnToBn(tokenConfig: TokenConfig, amount: BN): BigNumber {
  return exponentiatedBy(new BigNumber(amount?.toString()), tokenConfig.decimals);
}

export function anchorBnToString(tokenConfig: TokenConfig, amount: BN): string {
  return bnToString(tokenConfig, anchorBnToBn(tokenConfig, amount));
}

export function stringToAnchorBn(tokenConfig: TokenConfig, amount: string): BN {
  return bnToAnchorBn(tokenConfig, new BigNumber(amount));
}

export function stringCutDecimals(decimals: number, amount: string): string {
  if (isNaN(decimals) || decimals < 0 || Math.floor(decimals) !== decimals) {
    throw Error("Invalid decimals: " + decimals.toString());
  }
  const amountBN = new BigNumber(amount);
  if (amountBN.isNaN()) {
    throw Error("Invalid amount: " + amount);
  }

  const amountBNFixed = amountBN.toFixed(decimals);

  const decimalPointIndex = amountBNFixed.indexOf(".");
  if (decimalPointIndex < 0) {
    return amountBNFixed;
  }

  let lastNoneZeroIndex = decimalPointIndex - 1;
  for (let i = amountBNFixed.length - 1; i > decimalPointIndex; i--) {
    if (amountBNFixed[i] !== "0") {
      lastNoneZeroIndex = i;
      break;
    }
  }
  return amount.substring(0, lastNoneZeroIndex + 1);
}

export function stringCutTokenDecimals(tokenConfig: TokenConfig, amount: string) {
  return stringCutDecimals(tokenConfig.decimals, amount);
}
