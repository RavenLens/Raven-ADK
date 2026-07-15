import { AgentModel } from "../ReAct.agent";

/* TODO: Define the logic for specified models */

/**
 * Allow to process everything in one step by one-model for the best performance
 */
export class AvatarOneStepPipeline {
  static name: "1-step" = "1-step";
  config: {
    /** The model/system is able to process all in */
    allInGenerator: AgentModel;
  }

  constructor(config: AvatarOneStepPipeline["config"]) {
    this.config = config;
  }
}

/**
 * Processes avatar in 2 steps for the best quality output
 */
export class AvatarTwoStepPipeline {
  static name: "2-step" = "2-step";
  config: {
    /** Gets acoustic feature dynamic vectors out of speech */
    featureExtractor?: AgentModel;
    generator: AgentModel;
  }

  constructor(config: AvatarTwoStepPipeline["config"]) {
    this.config = config;
  }
}
