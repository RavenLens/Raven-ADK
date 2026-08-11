export interface TruthnessState { 
    from: number;
    to: number;
    truthy: boolean; 
    baseOnRecource: string;
};

export type FactSentry = (fact: string) => TruthnessState | Promise<TruthnessState>;

export interface FactCheckerConfig {
    toCheck: string;
    verifiers: FactSentry | FactSentry[];
}

export class FactChecker {
    config: FactCheckerConfig;
    
    constructor(config: FactCheckerConfig) {
        this.config = config;
    }

    async check(): Promise<TruthnessState[]> {
        const verifiers = Array.isArray(this.config.verifiers)
            ? this.config.verifiers
            : [this.config.verifiers];

        return Promise.all(verifiers.map(verifier => verifier(this.config.toCheck)));
    }

    /** Replaces untruthful ranges with the evidence supplied by their verifiers. */
    async improve(rating: TruthnessState[]): Promise<string> {
        let improved = this.config.toCheck;

        const untruthfulRatings = rating
            .map((state, index) => ({ state, index }))
            .filter(({ state }) => !state.truthy)
            .sort((left, right) =>
                right.state.from - left.state.from ||
                right.state.to - left.state.to ||
                right.index - left.index
            );

        for (const { state } of untruthfulRatings) {
            improved = improved.slice(0, state.from) + state.baseOnRecource + improved.slice(state.to);
        }

        return improved;

    }
}
