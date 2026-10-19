/**
 * @description 仅可信Host组装入口注入的固定producer契约；Kernel不依赖具体业务实现。
 */
export interface IHostResourceFieldProducer {
    /**
     * @description 对Host真实工程中的原输入运行固定无写入准备；实现不得接受外部Error或回调。
     */
    prepare(projectRoot: string, input: unknown): Promise<void>;
}

export type {
    DesignSourceCapabilityId,
    IAssetCatalogClient,
    IAssetDeleteClient,
    IAssetReadAssetSnapshot,
    IAssetReadClient,
    IAssetReadAssetSubSnapshot,
    IAssetWriteClient,
    ICanvasContext2D,
    ICanvasImage,
    ICanvasImageData,
    ICanvasService,
    ICanvasSurface,
    ICreatorVersionClient,
    IDesignSourceCapabilityDescriptor,
    IGrantedRuntimeClientSet,
    IMessageClient,
    IMcpCapabilityInvocation,
    IMcpCapabilityProgress,
    INativeCapabilityClientSet,
    IPanelBridgeClientFactory,
    IPluginActivateContext,
    IPluginEventBus,
    IPluginFileStorageApi,
    IPluginLogger,
    IPluginManagedTaskApi,
    IPluginTaskExecutorOptions,
    IPluginMcpApi,
    IPluginModule,
    IPluginNetworkClient,
    IPluginNetworkRequest,
    IPluginNetworkResponse,
    IPluginPanelApi,
    IPluginProtectedKeyApi,
    IPluginRegisterContext,
    IPluginRegistrationApi,
    IPluginRegistrationInput,
    IPluginServiceApi,
    IPluginStorageApi,
    IPluginTaskApi,
    IPluginTaskExecutorContext,
    IProjectReadClient,
    ISceneClient,
    ISelectionClient,
    McpCapabilityHandler,
    PluginManagedTaskRequest,
    PluginTaskExecutor,
} from '@peanut/pod-sdk';
