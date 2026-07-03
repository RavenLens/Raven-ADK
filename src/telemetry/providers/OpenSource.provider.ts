import { TelemetryProviderSchema } from "./schema";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { 
    BasicTracerProvider, 
    BatchSpanProcessor 
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { 
    MeterProvider, 
    PeriodicExportingMetricReader
} from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { metrics } from "@opentelemetry/api";

interface StandardOTELProviderConfig {
    /** 
     * Base URL for the OTLP collector. 
     * If provided, will automatically append /v1/traces and /v1/metrics.
     * Use full URLs in tracesURL/metricsURL for specific overrides.
     */
    url?: string;
    /** Specific URL for traces. Defaults to url + "/v1/traces" */
    tracesURL?: string;
    /** Specific URL for metrics. Defaults to url + "/v1/metrics" */
    metricsURL?: string;
    /** Optional headers for all requests */
    headers?: Record<string, string>;
    /** Service Name for identifies this agent in the collector (e.g. Jaeger) */
    serviceName?: string;
}

/**
 * Standard OTLP Telemetry Provider.
 * Connects Raven ADK to any OpenTelemetry compatible collector (Jaeger, Honeycomb, Otel-Collector, etc).
 */
export class OpenSourceTelemetryProvider implements TelemetryProviderSchema {
    ProviderName: string = "Standard_OTLP_TelemetryProvider";
    private tracerProvider: BasicTracerProvider;
    private meterProvider: MeterProvider;
    
    constructor(config: StandardOTELProviderConfig = {}) {
        const resource = new Resource({
            [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName || "raven-adk-agent",
        });

        // 1. Configure Tracing
        this.tracerProvider = new BasicTracerProvider({
            resource: resource,
        });

        const traceExporter = new OTLPTraceExporter({
            url: config.tracesURL || (config.url ? `${config.url}/v1/traces` : undefined),
            headers: config.headers,
        });

        // Use BatchSpanProcessor for production-grade performance
        this.tracerProvider.addSpanProcessor(new BatchSpanProcessor(traceExporter));
        
        // Register this provider globally so all @opentelemetry/api calls use it
        this.tracerProvider.register();

        // 2. Configure Metrics
        const metricExporter = new OTLPMetricExporter({
            url: config.metricsURL || (config.url ? `${config.url}/v1/metrics` : undefined),
            headers: config.headers,
        });

        this.meterProvider = new MeterProvider({
            resource: resource,
            readers: [
                new PeriodicExportingMetricReader({
                    exporter: metricExporter,
                    exportIntervalMillis: 60000,
                }),
            ],
        });

        // Register metrics globally
        metrics.setGlobalMeterProvider(this.meterProvider);
    }
    
    /**
     * Flushes all pending telemetry data to the collector.
     * This is called when the ReActAgent stops to ensure no data is lost.
     */
    async send(): Promise<boolean> {
        try {
            // Wait for both traces and metrics to be exported
            await Promise.all([
                this.tracerProvider.forceFlush(),
                this.meterProvider.forceFlush(),
            ]);
            return true;
        } catch (error) {
            console.error("[Telemetry] Failed to flush OTel metrics/traces:", error);
            return false;
        }
    }
}
