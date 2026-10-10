UPDATE expressions
SET body = ''
WHERE btrim(body) = '图片情报'
  AND EXISTS (
    SELECT 1 FROM expression_images ei WHERE ei.expression_id = expressions.id
  );

ALTER TABLE expressions DROP CONSTRAINT IF EXISTS expressions_card_image_id_fkey;
ALTER TABLE expressions DROP COLUMN IF EXISTS card_image_id;
ALTER TABLE expressions DROP COLUMN IF EXISTS card_image_source;

DELETE FROM uploads u
WHERE u.mime = 'image/svg+xml'
  AND NOT EXISTS (SELECT 1 FROM expression_images ei WHERE ei.upload_id = u.id);

ALTER TABLE expressions DROP CONSTRAINT IF EXISTS expressions_reject_code_check;
UPDATE expressions
SET reject_code = NULL
WHERE reject_code IS NOT NULL AND reject_code <> 'violation';
ALTER TABLE expressions ADD CONSTRAINT expressions_reject_code_check
  CHECK (reject_code IS NULL OR reject_code = 'violation');
