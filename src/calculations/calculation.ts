import BigNumber from "bignumber.js";
import { BigNumberWithConfig, validate } from "./utils";
import { approximateOutAmount } from "./approximation";

const FLOAT_ROUND_UP_ESPSILON: number = 0.00000000000000006;

/**
 * calculate out amount from v2 g(m) curve, with slope=1 case. the formula is:
 * - token_b_output = b - b * ((a / (a + m))^(P * A / B))
 * - a = current_reserve_a, b = current_reserve_b (current token reserves in the pool)
 * - m is the amount of token a trader want to sell to us
 * - A = target_reserve_a, B = target_reserve_b (A/B is the token ratio we want to maintain)
 * - P = market price, (the number of token b can be purchased by 1 token a)
 */
export function calculateOutAmountNormalSwapInternal(
  marketPrice: BigNumber,
  targetReserveA: BigNumber,
  targetReserveB: BigNumber,
  currentReserveA: BigNumber,
  currentResreveB: BigNumber,
  inputAAmount: BigNumber,
): BigNumber {
  // when we calculate amountIn from amountOut, we will have negative inputAAmount with a negative result
  // the result must be a negative value. If currentReserveA + inputAAmount < 0, the result
  // is negative
  const coreDenumerator: BigNumber = currentReserveA.plus(inputAAmount);
  if (coreDenumerator.isNegative()) {
    return new BigNumber(-Infinity);
  }

  // need to ceil the core
  let core: BigNumber = BigNumberWithConfig(currentReserveA, {
    ROUNDING_MODE: BigNumber.ROUND_CEIL,
  }).dividedBy(coreDenumerator);

  // need to floor the exp
  let exp: BigNumber = BigNumberWithConfig(marketPrice, {
    ROUNDING_MODE: BigNumber.ROUND_FLOOR,
  })
    .multipliedBy(targetReserveA)
    .dividedBy(targetReserveB);

  let coreNumber = core.toNumber();
  let expNumber = exp.toNumber();
  // round up the float value of core^exp
  let coreExpNumber = Math.pow(coreNumber, expNumber) + FLOAT_ROUND_UP_ESPSILON;

  // need to ceil the coreExp
  let coreExp: BigNumber = BigNumberWithConfig(currentResreveB.toNumber(), {
    ROUNDING_MODE: BigNumber.ROUND_CEIL,
  }).multipliedBy(new BigNumber(coreExpNumber));

  return currentResreveB.minus(coreExp);
}

/**
 * get the maximum value between the approximation result and calculation using
 * calculate_out_amount_normal_swap_internal
 * both approximation and calculation results are guaranteed to be less or equal to
 * the theoretical value. we take max of them to get a closer value to the ideal result
 */
export function calculateOutAmountNormalSwap(
  marketPrice: BigNumber,
  targetReserveA: BigNumber,
  targetReserveB: BigNumber,
  currentReserveA: BigNumber,
  currentReserveB: BigNumber,
  inputAAmount: BigNumber,
): {
  outAmount: BigNumber;
  priceImpact: BigNumber;
} {
  const { impliedOutAmount, approximationResult } = approximateOutAmount(
    currentReserveA,
    currentReserveB,
    targetReserveA,
    targetReserveB,
    marketPrice,
    inputAAmount,
  );

  const calculationResult = Math.floor(
    calculateOutAmountNormalSwapInternal(
      marketPrice,
      targetReserveA,
      targetReserveB,
      currentReserveA,
      currentReserveB,
      inputAAmount,
    ).toNumber(),
  );

  const outputBAmount =
    approximationResult === 0
      ? calculationResult
      : Math.max(approximationResult, calculationResult);

  validate(
    outputBAmount <= impliedOutAmount,
    "final result for swap out amount should not be larger than the implied out amount",
  );

  let impliedPrice: BigNumber = marketPrice
    .multipliedBy(currentReserveB)
    .multipliedBy(targetReserveA)
    .dividedBy(currentReserveA)
    .dividedBy(targetReserveB);

  let actualPrice: BigNumber = new BigNumber(outputBAmount).dividedBy(inputAAmount);
  let priceImpact: BigNumber = actualPrice.isEqualTo(Infinity)
    ? new BigNumber(Infinity)
    : impliedPrice.minus(actualPrice).dividedBy(actualPrice).abs();

  return { outAmount: new BigNumber(outputBAmount), priceImpact };
}

/**
 * in this function, given current reserves and target reserves, it calculates the balanced reserves
 * balanced reserves refer to the reserve point that is on the same reserve curve with current reserves
 * we can get the balanced_reserve_a as the positive solution to this quadratic equation:
 * - B/A*(2 - s)*x^2 + (s - 1)*((B/A)*a + b)*x - s*a*b
 * - A = target_reserve_a, B = target_reserve_b
 * - s = slope (the value that determines the flatteness of the curve)
 * because stable swap has a static price, and we maintain the B/A is same as the price all the time
 * we can assume the static_price=B/A and stable_price as static B/A in this function for simplicity
 * for the equation, let:
 * - coef_a = B/A*(2 - s)
 * - coef_b = (s - 1)*((B/A)*a + b)
 * - coef_c= -s*a*b
 * then the equation is:
 * - coef_a*x^2 + coef_b*x + coef_c
 * the only positive solution is: (-coef_b + sqrt(coef_b^2 - 4*coef_a*coef_c))/2*coef_a
 * after getting balanced_reserve_a, balanced_reserve_b = balanced_reserve_a *(B/A)
 */
export function calculateBalancedReservesStableSwap(
  stablePrice: BigNumber,
  currentReserveA: BigNumber,
  currentResreveB: BigNumber,
  slope: BigNumber,
): { balancedReserveA: BigNumber; balancedReserveB: BigNumber } {
  let coefA: BigNumber = new BigNumber(2).minus(slope).multipliedBy(stablePrice);
  let coefBNeg: BigNumber = new BigNumber(1)
    .minus(slope)
    .multipliedBy(currentReserveA.multipliedBy(stablePrice).plus(currentResreveB));
  let coefCNeg: BigNumber = slope.multipliedBy(currentReserveA).multipliedBy(currentResreveB);
  // need to ceil the sqrt
  let core: BigNumber = BigNumberWithConfig(
    coefBNeg
      .multipliedBy(coefBNeg)
      .plus(coefA.multipliedBy(coefCNeg).multipliedBy(new BigNumber(4))),
    {
      ROUNDING_MODE: BigNumber.ROUND_CEIL,
    },
  ).squareRoot();

  // need to ceil the div
  let balancedReserveA: BigNumber = BigNumberWithConfig(coefBNeg.plus(core), {
    ROUNDING_MODE: BigNumber.ROUND_CEIL,
  })
    .dividedBy(coefA)
    .dividedBy(new BigNumber(2));
  let balancedReserveB: BigNumber = balancedReserveA.multipliedBy(stablePrice);

  return { balancedReserveA, balancedReserveB };
}

/**
 * calculate out amount from v2 g(m) curve, with any slope and market price P is a constant
 * this function implements the formula below, for internal use in this module only, the formula is:
 * - token_b_output = (b + (1 - s)/s * B) * (1 - (s * a + (1 - s) * A)/(s * (a + m) + (1 - s) * A))
 * - a = current_reserve_a, b = current_reserve_b (current token reserves in the pool)
 * - m is the amount of token a trader want to sell to us
 * - A = balanced_reserve_a, B = balanced_reserve_b.
 * - s = slope (value that determines the flatteness of the curve)
 */
export function calculateOutAmountStableSwapInternal(
  balancedReserveA: BigNumber,
  balancedReserveB: BigNumber,
  currentReserveA: BigNumber,
  currentResreveB: BigNumber,
  inputAAmount: BigNumber,
  slope: BigNumber,
): BigNumber {
  // need to floor the multiplicand
  let multiplicand: BigNumber = BigNumberWithConfig(
    balancedReserveB.multipliedBy(new BigNumber(1).minus(slope)),
    {
      ROUNDING_MODE: BigNumber.ROUND_FLOOR,
    },
  )
    .dividedBy(slope)
    .plus(currentResreveB);

  let coreNumerator: BigNumber = new BigNumber(1)
    .minus(slope)
    .multipliedBy(balancedReserveA)
    .plus(slope.multipliedBy(currentReserveA));

  let coreDenumerator: BigNumber = new BigNumber(1)
    .minus(slope)
    .multipliedBy(balancedReserveA)
    .plus(slope.multipliedBy(currentReserveA.plus(inputAAmount)));

  // similar to the normal swap, the result should be -infinity if this denumerator has negative value
  if (coreDenumerator.isLessThanOrEqualTo(0)) {
    return new BigNumber(-Infinity);
  }

  // need to floor the multiplier
  let multiplier: BigNumber = new BigNumber(1).minus(
    BigNumberWithConfig(coreNumerator, {
      ROUNDING_MODE: BigNumber.ROUND_FLOOR,
    }).dividedBy(coreDenumerator),
  );

  return multiplicand.multipliedBy(multiplier);
}

/**
 * interface to the pool get out amount
 * get balanced reserves from current and target reserves
 * then calculate the out amount
 */
export function calculateOutAmountStableSwap(
  stablePrice: BigNumber,
  currentReserveA: BigNumber,
  currentReserveB: BigNumber,
  inputAAmount: BigNumber,
  slope: BigNumber,
): {
  outAmount: BigNumber;
  priceImpact: BigNumber;
} {
  let { balancedReserveA, balancedReserveB } = calculateBalancedReservesStableSwap(
    stablePrice,
    currentReserveA,
    currentReserveB,
    slope,
  );

  let outputBAmount: BigNumber = calculateOutAmountStableSwapInternal(
    balancedReserveA,
    balancedReserveB,
    currentReserveA,
    currentReserveB,
    inputAAmount,
    slope,
  );

  // in theory: impliedPrice = stablePrice * balancedReserveA/balancedReserveB * currentReserveB/currentReserveA
  // in stable swap we have guaranteed that stablePrice * balancedReserveA/balancedReserveB = 1
  // therefore: impliedPrice = currentReserveB/currentReserveA
  let impliedPrice: BigNumber = currentReserveB
    .plus(balancedReserveB.multipliedBy(new BigNumber(1).minus(slope)).dividedBy(slope))
    .dividedBy(
      currentReserveA.plus(
        balancedReserveA.multipliedBy(new BigNumber(1).minus(slope).dividedBy(slope)),
      ),
    );

  let actualPrice: BigNumber = outputBAmount.dividedBy(inputAAmount);
  let priceImpact: BigNumber = impliedPrice.minus(actualPrice).dividedBy(actualPrice).abs();

  return {
    outAmount: new BigNumber(outputBAmount.toFixed(0)),
    priceImpact,
  };
}
