'use strict';

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable('comments', table => {
    table.renameColumn('document_id', 'page_ref');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('comments', table => {
    table.renameColumn('page_ref', 'document_id');
  });
};
