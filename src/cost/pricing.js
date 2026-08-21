'use strict';



const COST_DECIMALS = 8;


const PRICING = {
  
  'openai/gpt-oss-20b': { inputPer1M: 0.10, outputPer1M: 0.50 },

  'mock-model': { inputPer1M: 1.0, outputPer1M: 2.0 },
};


const UNKNOWN_PRICING = { inputPer1M: 0, outputPer1M: 0 };

function getRate(model) {
  const rate = PRICING[model];
  if (!rate) {
    return { ...UNKNOWN_PRICING, known: false };
  }
  return { ...rate, known: true };
}

function computeCost(model, inputTokens, outputTokens) {
  const rate = getRate(model);
  const inTok = Number.isFinite(inputTokens) ? inputTokens : 0;
  const outTok = Number.isFinite(outputTokens) ? outputTokens : 0;

  const inputCost = (inTok / 1_000_000) * rate.inputPer1M;
  const outputCost = (outTok / 1_000_000) * rate.outputPer1M;
  const total = inputCost + outputCost;

  return {
    totalCost: total.toFixed(COST_DECIMALS),
    known: rate.known,
    rate: { inputPer1M: rate.inputPer1M, outputPer1M: rate.outputPer1M },
  };
}

module.exports = {
  COST_DECIMALS,
  PRICING,
  getRate,
  computeCost,
};