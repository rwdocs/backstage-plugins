// @ts-check
/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('comments', table => {
    table.uuid('id').primary(); // uuid v7
    table.text('site_ref').notNullable();
    table.text('document_id').notNullable();
    table.text('entity_ref').notNullable();
    table.uuid('parent_id').nullable();
    table.text('author_ref').notNullable();
    table.text('author_profile').nullable(); // JSON {displayName, picture?}
    table.text('body').notNullable();
    table.text('body_html').notNullable();
    table.text('selectors').notNullable(); // JSON Selector[]
    table.text('status').notNullable(); // 'open' | 'resolved'
    table.dateTime('created_at').notNullable();
    table.dateTime('updated_at').notNullable();
    table.dateTime('resolved_at').nullable();
    table.text('resolved_by').nullable();
    table.dateTime('deleted_at').nullable();
    table.index(['site_ref', 'document_id'], 'comments_site_doc_idx');
    table.index(['site_ref', 'document_id', 'status'], 'comments_site_doc_status_idx');
    table.index(['parent_id'], 'comments_parent_idx');
    table.index(['entity_ref'], 'comments_entity_idx');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('comments');
};
