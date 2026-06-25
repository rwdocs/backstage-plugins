// @ts-check
/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('section_ownership', table => {
    table.text('site_ref').notNullable();
    table.text('section_ref').notNullable();
    table.text('entity_ref').notNullable();
    table.text('entity_owner_ref').nullable();
    table.primary(['site_ref', 'section_ref']);
    table.index(['entity_owner_ref'], 'section_ownership_owner_idx');
  });
  // The `sections` table is dense (one row per section) and carries both structure
  // (parent_section_ref) and the effective-ownership rollup (entity_ref, entity_owner_ref, and an
  // owner-relative section_path). The owner index is pre-positioned for the inbox's
  // "sections owned by X" query (the consumer lands in a separate change).
  await knex.schema.createTable('sections', table => {
    table.text('site_ref').notNullable();
    table.text('section_ref').notNullable();
    table.text('section_path').notNullable();
    table.text('parent_section_ref').nullable();
    table.text('entity_ref').notNullable();
    table.text('entity_owner_ref').nullable();
    table.primary(['site_ref', 'section_ref']);
    table.index(['entity_owner_ref'], 'sections_owner_idx');
  });
  await knex.schema.createTable('pages', table => {
    table.text('site_ref').notNullable();
    table.text('section_ref').notNullable();
    table.text('subpath').notNullable();
    table.text('title').notNullable();
    table.primary(['site_ref', 'section_ref', 'subpath']);
  });
  await knex.schema.createTable('site_refresh', table => {
    table.text('site_ref').primary();
    table.dateTime('next_update_at').notNullable();
    table.dateTime('last_built_at').nullable();
    table.text('result_hash').nullable();
    table.text('errors').nullable();
    table.dateTime('last_discovery_at').notNullable();
    table.index(['next_update_at'], 'site_refresh_next_update_idx');
  });
};
/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('site_refresh');
  await knex.schema.dropTableIfExists('pages');
  await knex.schema.dropTableIfExists('sections');
  await knex.schema.dropTableIfExists('section_ownership');
};
