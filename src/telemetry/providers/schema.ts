export interface TelemetryProviderSchema {
    ProviderName: string;
    /** 
     * Function that takes the telemetry logs and send with some protocol or apporach to the provider
     * Takes the logs out of telemetry and sends it to the server collector or some bucket
    */
    send(): Promise<boolean>;
}
