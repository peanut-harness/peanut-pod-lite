import assert from 'node:assert/strict';
import test from 'node:test';

import type { ICreatorContext, ICreatorVersionInfo } from '@peanut/pod-protocol';

import { CreatorOperationAvailabilityMatrix } from '../dist/index.js';

/**
 * @description 创建矩阵测试所需的最小可信 Creator 上下文。
 * @param profileId 画像 id
 * @param rawVersion Creator 版本
 * @param support 支持等级
 * @param writesAllowed 是否允许写入
 * @returns Creator 上下文
 */
function createContext(
    profileId: ICreatorContext['profileId'],
    rawVersion: string,
    support: ICreatorContext['support'],
    writesAllowed: boolean,
): ICreatorContext {
    const versionParts = rawVersion.split('.');
    const version: ICreatorVersionInfo = {
        raw: rawVersion,
        major: Number(versionParts[0] ?? Number.NaN),
        minor: Number(versionParts[1] ?? Number.NaN),
        patch: Number(versionParts[2] ?? Number.NaN),
        phase: rawVersion.startsWith('2.')
            ? 'creator_2x'
            : rawVersion.startsWith('3.0') || rawVersion.startsWith('3.5')
              ? 'creator_3x_early'
              : 'editor_api_stable',
    };
    return {
        version,
        projectVersion: version,
        profileId,
        hostFamily: profileId === 'creator-24' ? 'creator-2x' : 'creator-3x',
        support,
        writesAllowed,
        diagnostics: [],
    };
}

test('Creator operation matrix covers all 83 operations across all four profiles', (): void => {
    const contexts = [
        createContext('creator-24', '2.4.11', 'experimental', false),
        createContext('creator-30-35', '3.5.2', 'experimental', false),
        createContext('creator-36-37', '3.7.4', 'unsupported', false),
        createContext('creator-38', '3.8.7', 'full', true),
    ];

    for (const context of contexts) {
        const matrix = CreatorOperationAvailabilityMatrix.list(context);
        assert.equal(matrix.length, 83);
        assert.equal(new Set(matrix.map((entry) => entry.operation)).size, 83);
    }
});

test('Creator operation matrix keeps writes fail-closed outside verified 3.8.7', (): void => {
    const creator24 = CreatorOperationAvailabilityMatrix.list(
        createContext('creator-24', '2.4.11', 'experimental', false),
    );
    const unsupported = CreatorOperationAvailabilityMatrix.list(
        createContext('creator-36-37', '3.7.4', 'unsupported', false),
    );
    const verified = CreatorOperationAvailabilityMatrix.list(
        createContext('creator-38', '3.8.7', 'full', true),
    );

    assert.equal(creator24.filter((entry) => entry.availability === 'available').length, 38);
    assert.equal(creator24.filter((entry) => entry.availability === 'read_only').length, 45);
    assert.equal(unsupported.every((entry) => entry.availability === 'refused'), true);
    assert.equal(verified.filter((entry) => entry.availability === 'available').length, 38);
    assert.equal(verified.filter((entry) => entry.availability === 'write').length, 45);
});
