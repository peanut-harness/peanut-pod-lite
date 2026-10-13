import { realpathSync } from 'fs';
import { isAbsolute, relative, resolve, sep } from 'path';

interface IOpenDialogResult {
    canceled: boolean;
    filePaths: string[];
}

interface IOpenDialog {
    showOpenDialog(options: object): Promise<IOpenDialogResult>;
}

/** @description 把 SnowB 文件选择限制在用户明确选择的文件和当前项目 assets 内。 */
export class SnowbDialogs {
    private readonly getDialog: () => IOpenDialog;

    public constructor(getDialog: () => IOpenDialog) {
        this.getDialog = getDialog;
    }

    public async pickSbfFile(defaultDirectory: string): Promise<string | null> {
        const result = await this.getDialog().showOpenDialog({
            title: '打开 SnowB 工程',
            defaultPath: defaultDirectory,
            properties: ['openFile'],
            filters: [{ name: 'SnowB 工程', extensions: ['sbf'] }],
        });
        return result.canceled ? null : result.filePaths[0] ?? null;
    }

    public async pickPublishTarget(projectDirectory: string): Promise<string | null> {
        const assetsRoot = realpathSync(resolve(projectDirectory, 'assets'));
        const result = await this.getDialog().showOpenDialog({
            title: '选择 BMFont 发布目录',
            defaultPath: assetsRoot,
            properties: ['openDirectory'],
        });
        if (result.canceled || result.filePaths[0] == null) return null;
        const selected = realpathSync(result.filePaths[0]);
        const fromAssets = relative(assetsRoot, selected);
        if (fromAssets === '..' || fromAssets.startsWith(`..${sep}`) || isAbsolute(fromAssets)) {
            throw new Error('snowb_asset_target_outside_assets');
        }
        return `db://assets/${fromAssets.split(sep).join('/')}`;
    }
}
