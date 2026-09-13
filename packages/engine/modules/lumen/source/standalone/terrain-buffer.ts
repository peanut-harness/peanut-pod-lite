/**
 * @description 对照引擎 `TerrainBuffer` 的小端读写。
 */
export class TerrainBuffer {
    /**
     * @description 已写入或文件有效长度。
     */
    public length = 0;

    /**
     * @description 底层字节。
     */
    public buffer: Uint8Array = new Uint8Array(2048);

    /**
     * @description DataView。
     */
    private _buffView: DataView = new DataView(this.buffer.buffer);

    /**
     * @description 读指针（含 `byteOffset`）。
     */
    private _seekPos = 0;

    /**
     * @description 保证容量。
     * @param size 需要的最小长度
     */
    public reserve(size: number): void {
        if (this.buffer.byteLength > size) {
            return;
        }
        let capacity = this.buffer.byteLength;
        while (capacity < size) {
            capacity += capacity;
        }
        const temp = new Uint8Array(capacity);
        for (let i = 0; i < this.length; i += 1) {
            temp[i] = this.buffer[i];
        }
        this.buffer = temp;
        this._buffView = new DataView(this.buffer.buffer);
    }

    /**
     * @description 绑定已有字节供读取。
     * @param buff 文件内容
     */
    public assign(buff: Uint8Array): void {
        this.buffer = buff;
        this.length = buff.length;
        this._seekPos = buff.byteOffset;
        this._buffView = new DataView(buff.buffer);
    }

    /**
     * @description 写 int8。
     * @param value 值
     */
    public writeInt8(value: number): void {
        this.reserve(this.length + 1);
        this._buffView.setInt8(this.length, value);
        this.length += 1;
    }

    /**
     * @description 写 int16 LE。
     * @param value 值
     */
    public writeInt16(value: number): void {
        this.reserve(this.length + 2);
        this._buffView.setInt16(this.length, value, true);
        this.length += 2;
    }

    /**
     * @description 写 int32 LE。
     * @param value 值
     */
    public writeInt32(value: number): void {
        this.reserve(this.length + 4);
        this._buffView.setInt32(this.length, value, true);
        this.length += 4;
    }

    /**
     * @description 连续写 int32，无长度前缀。
     * @param value 数组
     */
    public writeIntArray(value: readonly number[]): void {
        this.reserve(this.length + 4 * value.length);
        for (let i = 0; i < value.length; i += 1) {
            this._buffView.setInt32(this.length + i * 4, value[i], true);
        }
        this.length += 4 * value.length;
    }

    /**
     * @description 写 float32 LE。
     * @param value 值
     */
    public writeFloat(value: number): void {
        this.reserve(this.length + 4);
        this._buffView.setFloat32(this.length, value, true);
        this.length += 4;
    }

    /**
     * @description 写 float64 LE。
     * @param value 值
     */
    public writeDouble(value: number): void {
        this.reserve(this.length + 8);
        this._buffView.setFloat64(this.length, value, true);
        this.length += 8;
    }

    /**
     * @description 写长度前缀 ASCII 字符串。
     * @param value 文本
     */
    public writeString(value: string): void {
        this.reserve(this.length + value.length + 4);
        this._buffView.setInt32(this.length, value.length, true);
        for (let i = 0; i < value.length; i += 1) {
            this._buffView.setInt8(this.length + 4 + i, value.charCodeAt(i));
        }
        this.length += value.length + 4;
    }

    /**
     * @description 读 int8。
     * @returns 值
     */
    public readInt8(): number {
        const value = this._buffView.getInt8(this._seekPos);
        this._seekPos += 1;
        return value;
    }

    /**
     * @description 读 int16 LE。
     * @returns 值
     */
    public readInt16(): number {
        const value = this._buffView.getInt16(this._seekPos, true);
        this._seekPos += 2;
        return value;
    }

    /**
     * @description 读 int32 LE。
     * @returns 值
     */
    public readInt(): number {
        const value = this._buffView.getInt32(this._seekPos, true);
        this._seekPos += 4;
        return value;
    }

    /**
     * @description 填入已有数组。
     * @param value 输出
     * @returns 同一数组
     */
    public readIntArray(value: number[]): number[] {
        for (let i = 0; i < value.length; i += 1) {
            value[i] = this._buffView.getInt32(this._seekPos + i * 4, true);
        }
        this._seekPos += 4 * value.length;
        return value;
    }

    /**
     * @description 读 float32 LE。
     * @returns 值
     */
    public readFloat(): number {
        const value = this._buffView.getFloat32(this._seekPos, true);
        this._seekPos += 4;
        return value;
    }

    /**
     * @description 读 float64 LE。
     * @returns 值
     */
    public readDouble(): number {
        const value = this._buffView.getFloat64(this._seekPos, true);
        this._seekPos += 8;
        return value;
    }

    /**
     * @description 读长度前缀 ASCII。
     * @returns 文本
     */
    public readString(): string {
        const stringLength = this.readInt();
        if (stringLength < 0 || stringLength > this.length) {
            throw new Error('lumen_terrain_corrupt:string');
        }
        let value = '';
        for (let i = 0; i < stringLength; i += 1) {
            value += String.fromCharCode(this.readInt8());
        }
        return value;
    }
}
