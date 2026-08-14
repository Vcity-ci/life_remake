export function createDefaultGameplayTuning() {
    return {
        bootstrap: {
            talentPointMin: 25,
            talentPointMax: 35,
            selectedCardMin: 1,
            selectedCardMax: 3
        },
        pacing: {
            maxYearsPerChunk: 2,
            specialYearChance: 0.18,
            blankYearChance: 0.22
        },
        milestone: {
            minEligibleAge: 5,
            guaranteeYears: 20,
            triggerRateByStage: {
                child: 0.05,
                youth: 0.1,
                prime: 0.15,
                middle: 0.15,
                elder: 0.15
            }
        },
        stage: {
            deltaCapByStage: {
                child: 2,
                youth: 4,
                prime: 6,
                middle: 8,
                elder: 8
            },
            lightBandRatio: 0.34,
            mediumBandRatio: 0.67,
            overallExtremeRatio: 0.75
        },
        growth: {
            baseGrowthChance: 0.28,
            baseDecayChance: 0.15,
            decayVolatilityFactor: 0.85,
            growthChanceClampMin: 0.06,
            growthChanceClampMax: 0.86,
            decayChanceClampMin: 0.05,
            decayChanceClampMax: 0.82,
            decayBranchFactor: 0.6,
            specialPositiveBaseChance: 0.55,
            specialPositiveGrowthBiasFactor: 0.5
        },
        decision: {
            profiles: {
                safe: {
                    successRate: 0.86,
                    gain: 2,
                    loss: -1,
                    deathBonus: 0,
                    risk: 0.2,
                    reward: 0.4
                },
                balanced: {
                    successRate: 0.66,
                    gain: 4,
                    loss: -2,
                    deathBonus: 0.05,
                    risk: 0.45,
                    reward: 0.65
                },
                risky: {
                    successRate: 0.48,
                    gain: 7,
                    loss: -4,
                    deathBonus: 0.12,
                    risk: 0.75,
                    reward: 0.95
                }
            },
            successRateVolatilityFactor: 0.2,
            successRateClampMin: 0.2,
            successRateClampMax: 0.9,
            gainClampMin: 1,
            gainClampMax: 4,
            lossClampMin: -4,
            lossClampMax: -1,
            secondarySuccessDelta: 1,
            secondaryFailureDelta: -1
        },
        death: {
            minAge: 14,
            negativeStreakTrigger: 4,
            lowPhysiqueThreshold: 3,
            physiqueBaseRisk: 0.08,
            physiqueMissingRiskFactor: 0.22,
            physiqueRiskClampMin: 0.08,
            physiqueRiskClampMax: 0.7,
            longNegativeBaseRisk: 0.03,
            longNegativeValueFactor: 0.2,
            longNegativeStreakDivisor: 6,
            longNegativeStreakFactor: 0.16,
            longNegativeRiskClampMin: 0.03,
            longNegativeRiskClampMax: 0.72,
            finalRiskClampMin: 0.01,
            finalRiskClampMax: 0.85
        },
        ascension: {
            deterministicStatThreshold: 50,
            chanceA: 0.02,
            chanceB: 0.02,
            chanceC: 0.02,
            highStatsThresholdA: 3,
            highStatsThresholdC: 3,
            fortuneThresholdA: 45,
            legendaryCountThresholdB: 1,
            intelligenceThresholdB: 40
        },
        fame: {
            intelligenceWeight: 1,
            charismaWeight: 1,
            familyWeight: 0,
            fortuneWeight: 1,
            physiqueWeight: 1,
            maxStatValue: 100,
            min: 0,
            max: 100
        },
        ending: {
            greatScore: 34,
            goodScore: 27,
            normalScore: 20
        }
    };
}
