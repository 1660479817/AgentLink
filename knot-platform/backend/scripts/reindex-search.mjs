// 回填检索索引：把每一行 intel 的 search_compact / search_bigrams 算出来。
//
// 这是纯派生数据：只读 body、detail、videos 与磁盘上的 extracts，只写这两列。
// 幂等，可反复跑；跑到一半停下也没关系，未回填的行在检索里仍有兜底条件。
//
//   node backend/scripts/reindex-search.mjs          # 全量回填
//   node backend/scripts/reindex-search.mjs --batch 50
//
// 需要站点运行时配置在环境里（deploy 脚本会 source platform.env）：
//   set -a; . sites/local/platform.env; set +a

import { loadBootstrapConfig } from "../src/config.js";
import { reindexSearch } from "../src/searchIndex.js";
import { getPool } from "../src/db.js";

function argValue(name, fallback) {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  return argv[index + 1] ?? fallback;
}

const batch = Math.max(1, Number(argValue("--batch", 200)) || 200);
const { databaseUrl } = loadBootstrapConfig();
const pool = getPool(databaseUrl);

let lastReport = 0;
try {
  const total = await reindexSearch(pool, {
    batch,
    onProgress: (done) => {
      // 每 1000 行报一次，避免长回填时看不出进度。
      if (done - lastReport >= 1000) {
        lastReport = done;
        console.log(`已回填 ${done} 行`);
      }
    },
  });
  console.log(`回填完成：${total} 行`);
} finally {
  await pool.end();
}
