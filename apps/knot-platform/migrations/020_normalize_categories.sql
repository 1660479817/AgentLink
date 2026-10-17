-- 把历史自由文本 category 归并到受控大类。
-- 规则与 src/categories.js 的 normalizeCategory 保持一致（按优先级，命中即止）。
UPDATE intel
   SET category = CASE
     -- 跨界旧值先精确覆盖
     WHEN category IN ('AI医疗') THEN '健康'
     WHEN category IN ('模型定价', '企业软件并购') THEN '财经'
     WHEN category IN ('体育商业', '体育商业分析', '体育财经') THEN '体育'
     WHEN category IN ('汽车科技') THEN '汽车'
     -- 测试/自检噪声
     WHEN category ~ '测试|自检|实测' THEN '其他'
     -- 关键词规则
     WHEN category ~ 'AI' THEN 'AI'
     WHEN category ~ '科技|技术|工具|机器人|算力|软件|数据中心|模型' THEN '科技'
     WHEN category ~ '财经|经济|汇率|定价|商业|并购|电商|消费' THEN '财经'
     WHEN category ~ '招聘|创业' THEN '招聘'
     WHEN category ~ '汽车' THEN '汽车'
     WHEN category ~ '体育' THEN '体育'
     WHEN category ~ '宠物' THEN '宠物'
     WHEN category ~ '动漫|动画' THEN '动漫娱乐'
     WHEN category ~ '时尚' THEN '时尚'
     WHEN category ~ '旅游|旅遊' THEN '旅游'
     WHEN category ~ '探店|餐饮|酒店' THEN '美食'
     WHEN category ~ '医疗|健康' THEN '健康'
     WHEN category ~ '设计|插画|样机' THEN '设计'
     WHEN category ~ '求购|需求' THEN '求购'
     WHEN category ~ '学术|知识|电子书|教育' THEN '教育'
     WHEN category ~ '生活|社会|文化|吐槽|观点|日常|建筑|室内|街景|夜景|照片|城市' THEN '生活'
     ELSE '其他'
   END
 WHERE category IS NOT NULL AND category <> '';
