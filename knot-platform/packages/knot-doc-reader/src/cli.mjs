// 命令行入口。参数与输出格式见 agents/knot-intel/AGENTS.md：
//   标准输出是一个 JSON，ok 为 false 时也退出 0。
import { execute } from "./index.mjs";

const result = await execute(process.argv.slice(2));
process.stdout.write(`${JSON.stringify(result.body)}\n`);
process.exit(result.code);
