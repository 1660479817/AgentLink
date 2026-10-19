// 数据评审员的工作区工具。实现与 Backend 共用 @knot/doc-reader。
//
// read-lib.mjs 是指向 packages/knot-doc-reader/src/index.mjs 的符号链接。
// ensure-openclaw.sh 同步工作区时会跟随链接，把内容复制成真实文件，
// 所以同步之后这里不需要 node_modules，也不依赖仓库路径。
import { execute } from "./read-lib.mjs";

const result = await execute(process.argv.slice(2));
process.stdout.write(`${JSON.stringify(result.body)}\n`);
process.exit(result.code);
