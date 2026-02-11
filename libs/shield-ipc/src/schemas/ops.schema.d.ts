/**
 * Zod schemas for broker operations
 */
import { z } from 'zod';
export declare const OperationTypeSchema: z.ZodEnum<{
    http_request: "http_request";
    file_read: "file_read";
    file_write: "file_write";
    file_list: "file_list";
    exec: "exec";
    open_url: "open_url";
    secret_inject: "secret_inject";
    ping: "ping";
    policy_check: "policy_check";
    events_batch: "events_batch";
}>;
export declare const HttpRequestParamsSchema: z.ZodObject<{
    url: z.ZodString;
    method: z.ZodOptional<z.ZodEnum<{
        GET: "GET";
        POST: "POST";
        PUT: "PUT";
        DELETE: "DELETE";
        PATCH: "PATCH";
        HEAD: "HEAD";
        OPTIONS: "OPTIONS";
    }>>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    body: z.ZodOptional<z.ZodString>;
    timeout: z.ZodOptional<z.ZodNumber>;
    followRedirects: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const FileReadParamsSchema: z.ZodObject<{
    path: z.ZodString;
    encoding: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const FileWriteParamsSchema: z.ZodObject<{
    path: z.ZodString;
    content: z.ZodString;
    encoding: z.ZodOptional<z.ZodString>;
    mode: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const FileListParamsSchema: z.ZodObject<{
    path: z.ZodString;
    recursive: z.ZodOptional<z.ZodBoolean>;
    pattern: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const ExecParamsSchema: z.ZodObject<{
    command: z.ZodString;
    args: z.ZodOptional<z.ZodArray<z.ZodString>>;
    cwd: z.ZodOptional<z.ZodString>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    timeout: z.ZodOptional<z.ZodNumber>;
    shell: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const OpenUrlParamsSchema: z.ZodObject<{
    url: z.ZodString;
    browser: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const SecretInjectParamsSchema: z.ZodObject<{
    name: z.ZodString;
    targetEnv: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const PingParamsSchema: z.ZodObject<{
    echo: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const PolicyCheckParamsSchema: z.ZodObject<{
    operation: z.ZodEnum<{
        http_request: "http_request";
        file_read: "file_read";
        file_write: "file_write";
        file_list: "file_list";
        exec: "exec";
        open_url: "open_url";
        secret_inject: "secret_inject";
        ping: "ping";
        policy_check: "policy_check";
        events_batch: "events_batch";
    }>;
    target: z.ZodString;
}, z.core.$strip>;
export declare const BrokerRequestSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    method: z.ZodEnum<{
        http_request: "http_request";
        file_read: "file_read";
        file_write: "file_write";
        file_list: "file_list";
        exec: "exec";
        open_url: "open_url";
        secret_inject: "secret_inject";
        ping: "ping";
        policy_check: "policy_check";
        events_batch: "events_batch";
    }>;
    params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    channel: z.ZodOptional<z.ZodEnum<{
        socket: "socket";
        http: "http";
    }>>;
}, z.core.$strip>;
export declare const BrokerErrorSchema: z.ZodObject<{
    code: z.ZodNumber;
    message: z.ZodString;
    data: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strip>;
export declare const BrokerResponseSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    result: z.ZodOptional<z.ZodUnknown>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodNumber;
        message: z.ZodString;
        data: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type OperationType = z.infer<typeof OperationTypeSchema>;
export type HttpRequestParams = z.infer<typeof HttpRequestParamsSchema>;
export type FileReadParams = z.infer<typeof FileReadParamsSchema>;
export type FileWriteParams = z.infer<typeof FileWriteParamsSchema>;
export type FileListParams = z.infer<typeof FileListParamsSchema>;
export type ExecParams = z.infer<typeof ExecParamsSchema>;
export type OpenUrlParams = z.infer<typeof OpenUrlParamsSchema>;
export type SecretInjectParams = z.infer<typeof SecretInjectParamsSchema>;
export type PingParams = z.infer<typeof PingParamsSchema>;
export type PolicyCheckParams = z.infer<typeof PolicyCheckParamsSchema>;
export type BrokerRequest = z.infer<typeof BrokerRequestSchema>;
export type BrokerError = z.infer<typeof BrokerErrorSchema>;
export type BrokerResponse = z.infer<typeof BrokerResponseSchema>;
//# sourceMappingURL=ops.schema.d.ts.map