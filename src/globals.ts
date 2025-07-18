import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Server as HttpServer } from 'http';

export let mcpServer: Server | undefined;
export let httpServer: HttpServer | undefined;

export const setMcpServer = (server: Server | undefined) => {
    mcpServer = server;
};

export const setHttpServer = (server: HttpServer | undefined) => {
    httpServer = server;
};
