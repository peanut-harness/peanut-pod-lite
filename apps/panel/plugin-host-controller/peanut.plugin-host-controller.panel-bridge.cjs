'use strict';

const EXTENSION_NAME = 'peanut-pod';
const SLOT_IDS = new Set(['plugin-host-1', 'plugin-host-2', 'plugin-host-3']);

function createResponse(request, ok, data, error) {
    return {
        type: 'snowb-cpm:response',
        requestId: request.requestId,
        requestType: request.type,
        ok,
        data,
        error,
    };
}

function readSlotRequest(request) {
    const payload = request?.payload;
    if (payload == null || typeof payload !== 'object' || Array.isArray(payload) || !SLOT_IDS.has(payload.hostSlotId)) {
        throw new Error('plugin_host_controller_slot_invalid');
    }
    return {
        hostSlotId: payload.hostSlotId,
    };
}

function readLoadRequest(request) {
    const slotRequest = readSlotRequest(request);
    const pluginId = request.payload.pluginId;
    if (typeof pluginId !== 'string' || pluginId.trim().length === 0) {
        throw new Error('plugin_host_controller_plugin_id_invalid');
    }
    return {
        pluginId,
        hostSlotId: slotRequest.hostSlotId,
    };
}

async function handleRequest(context) {
    const request = context?.request;
    if (typeof request?.requestId !== 'string' || request.requestId.length === 0) {
        throw new Error('plugin_host_controller_request_id_invalid');
    }
    const messageApi = context.editorApi?.Message;
    if (typeof messageApi?.request !== 'function') {
        return createResponse(request, false, undefined, 'plugin_host_controller_editor_message_unavailable');
    }
    try {
        if (request.type === 'snowb-cpm:plugin-host-load') {
            const payload = readLoadRequest(request);
            await messageApi.request(context.hostExtensionName ?? EXTENSION_NAME, 'load-plugin-into-host', payload);
            return createResponse(request, true, payload);
        }
        if (request.type === 'snowb-cpm:plugin-host-close') {
            const payload = readSlotRequest(request);
            await messageApi.request(context.hostExtensionName ?? EXTENSION_NAME, 'close-plugin-host', payload);
            return createResponse(request, true, payload);
        }
        return createResponse(request, false, undefined, 'plugin_host_controller_request_unsupported');
    } catch (error) {
        return createResponse(request, false, undefined, error instanceof Error ? error.message : String(error));
    }
}

module.exports = {
    handleRequest,
};
