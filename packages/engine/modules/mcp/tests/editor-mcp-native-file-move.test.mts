import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { EditorMcpNativeFileMove } from '../src/editor-mcp-native-file-move.js';
import { EditorMcpAssetDbTransaction } from '../src/editor-mcp-asset-db-transaction.js';
for (const mode of ['success', 'refused', 'changed-bytes', 'changed-uuid']) {
    test(`native font move exact message and independent proof: ${mode}`, async () => {
        const root = mkdtempSync(join(tmpdir(), 'native-font-move-'));mkdirSync(join(root, 'assets'));
        const from = 'assets/a.ttf', to = 'assets/b.ttf'; const meta = {uuid:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',importer:'ttf-font', imported:true};
        writeFileSync(join(root,from),'font-bytes');writeFileSync(join(root,from+'.meta'),JSON.stringify(meta));let moved=false;let moves=0;
        const message = { request: async <T = unknown,>(target:string, name:string, ...args:unknown[]):Promise<T> => {
            assert.equal(target,'asset-db');let result:unknown;
            if(name==='move-asset') {
                assert.deepEqual(args,[`db://${from}`,`db://${to}`,{overwrite:false}]);moves+=1;
                if(mode==='refused')throw new Error('actual-native-refusal');
                renameSync(join(root,from),join(root,to));renameSync(join(root,from+'.meta'),join(root,to+'.meta'));moved=true;
                if(mode==='changed-bytes')writeFileSync(join(root,to),'bad');
                if(mode==='changed-uuid')writeFileSync(join(root,to+'.meta'),JSON.stringify({...meta,uuid:'changed'}));
                result=meta;
            } else if(name==='query-ready')result=true;
            else if(name==='query-asset-info')result=String(args[0])===`db://${moved?to:from}`?meta:null;
            else throw new Error(`unexpected:${name}`);
            return result as T;
        }};
        const transaction=new EditorMcpAssetDbTransaction({requireProjectPath:async()=>root,requireMessage:()=>message,refreshForCommit:async()=>{throw new Error('must not refresh');}});
        try {
            const work=EditorMcpNativeFileMove.execute(root,from,to,message,transaction);
            if(mode==='success'){await work;assert.equal(readFileSync(join(root,to),'utf8'),'font-bytes');}
            else await assert.rejects(work,/actual-native-refusal|readback_mismatch/);
            assert.equal(moves,1);
        }finally{rmSync(root,{recursive:true,force:true});}
    });
}
