import BigNumber from "bignumber.js";
import { BigNumberWithConfig, validate } from "./utils";

/**
 * See "Approximation Method" in deltafi-dex-v2/contracts/programs/deltafi-dex-v2/src/curve/README.md
 * this function gets k = k1*k2 first
 * for simpler comments, let
 * - a = currentReserveA
 * - b = currentReserveB
 * - A = targetReserveA
 * - B = targetReserveB
 * - P = marketPrice
 * - m = inputAAmount
 * the return value is a tuple with 2 number value:
 * - impliedOutAmount: the amount in u64 using implied price
 *  - approximationResult: the amount of using this approximation
 */
export function approximateOutAmount(
  currentReserveA: BigNumber,
  currentReserveB: BigNumber,
  targetReserveA: BigNumber,
  targetReserveB: BigNumber,
  marketPrice: BigNumber,
  inputAAmount: BigNumber,
): {
  impliedOutAmount: number;
  approximationResult: number;
} {
  // impliedAmountOut = m*(b/a)*P*(A/B)
  const impliedOutAmountNumerator: BigNumber = currentReserveB
    .multipliedBy(inputAAmount)
    .multipliedBy(marketPrice)
    .multipliedBy(targetReserveA);

  const impliedOutAmountDenumerator: BigNumber = targetReserveB.multipliedBy(currentReserveA);
  const impliedOutAmountBigNumber: BigNumber = impliedOutAmountNumerator.dividedBy(
    impliedOutAmountDenumerator,
  );

  let expCeil: number = Math.ceil(
    marketPrice.multipliedBy(targetReserveA).dividedBy(targetReserveB).toNumber(),
  );

  validate(expCeil < (1 << 8) - 1, "exponent is too large");
  // if a*ceil(P*A/B) > A, this approximation is not a good approach for the result
  // and we are not able to calculate k1 and k2, just skip and return 0
  // the approximation works when trading amount is much smaller than reserve
  // if implied amount is larger than b, we skip and return 0
  if (
    currentReserveA.isLessThanOrEqualTo(inputAAmount.multipliedBy(expCeil)) ||
    currentReserveB.isLessThanOrEqualTo(inputAAmount)
  ) {
    return {
      impliedOutAmount: Math.floor(impliedOutAmountBigNumber.toNumber()),
      approximationResult: 0,
    };
  }

  // kProduct = k1 * k2
  const kProduct: BigNumber = approximateUpperBoundK(currentReserveA, inputAAmount, expCeil);
  // kMultiplier = kProduct - 1
  const kMultiplier: BigNumber = kProduct.minus(new BigNumber(1));
  // kMultiplicand = b - impliedAmount
  const kMultiplicand: BigNumber = currentReserveB.minus(impliedOutAmountBigNumber);
  // diffFromImpliedAmount = kMultiplier * kMultiplicand
  const diffFromImpliedAmount: BigNumber = kMultiplier.multipliedBy(kMultiplicand);

  if (impliedOutAmountBigNumber.abs().isLessThanOrEqualTo(diffFromImpliedAmount)) {
    return {
      impliedOutAmount: Math.floor(impliedOutAmountBigNumber.toNumber()),
      approximationResult: 0,
    };
  }

  // approximatoinResult = impliedAmountout - (b - impliedAmountout) * (k1*k2 - 1) = impliedAmountout - diffFromImpliedAmount
  const approximationResult: number = Math.floor(
    impliedOutAmountBigNumber.minus(diffFromImpliedAmount).toNumber(),
  );
  const impliedOutAmount: number = Math.floor(impliedOutAmountBigNumber.toNumber());
  validate(
    approximationResult <= impliedOutAmount,
    "approximation result should not be larger than the implied out amount",
  );

  return { impliedOutAmount, approximationResult };
}

/**
 * Approximate an upper bound of k
 * - (a/(a + m))^(P*A/B) = k_1*(1 - m/a)^(P*A/B)
 * - (1 - m/a)^(P*A/B) = k_2*(1 - (m/a)*(P*A/B))
 * - k = k1*k2
 * - coreHigh = (a/(a + m))^(P*A/B)
 * - coreLow = (1 - (m/a)*(P*A/B))
 * - k = coreHigh/coreLow
 */
export function approximateUpperBoundK(
  currentReserveA: BigNumber,
  inputAAmount: BigNumber,
  expCeil: number,
): BigNumber {
  // we need to ceil the coreHigh which is the numerator of the result
  let coreHigh: BigNumber = BigNumberWithConfig(currentReserveA, {
    ROUNDING_MODE: BigNumber.ROUND_CEIL,
  })
    .dividedBy(currentReserveA.plus(inputAAmount))
    .exponentiatedBy(expCeil);

  // we need to floor the coreLow which is the denumerator of the result
  let coreLow: BigNumber = BigNumberWithConfig(
    currentReserveA.minus(inputAAmount.multipliedBy(expCeil)),
    {
      ROUNDING_MODE: BigNumber.ROUND_FLOOR,
    },
  ).dividedBy(currentReserveA);

  return BigNumberWithConfig(coreHigh, {
    ROUNDING_MODE: BigNumber.ROUND_CEIL,
  }).dividedBy(coreLow);
}
