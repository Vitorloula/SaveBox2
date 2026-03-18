#include "storage/GarbageCollector.hpp"
#include "database/DatabasePool.hpp"
#include "storage/FileChunker.hpp"
#include <pqxx/pqxx>
#include <iostream>

GarbageCollector::GarbageCollector(DatabasePool& pool, FileChunker* chunker)
    : pool_(pool), chunker_(chunker) {}

void GarbageCollector::run_cleanup() {
    auto conn = pool_.acquire_connection();
    pqxx::work W(*conn);

    try {
        std::string query_select = R"(
            SELECT id FROM files
            WHERE (is_upload_complete = FALSE AND created_at < NOW() - INTERVAL '4 hours')
               OR (deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days')
        )";

        auto result = W.exec(query_select);

        for (const auto& row : result) {
            uint64_t file_id = row[0].as<uint64_t>();
            try {
                if (chunker_) {
                    chunker_->delete_file(file_id);
                }
            } catch (const std::exception& e) {
                std::cerr << "GC: Falha ao deletar arquivo fisico " << file_id << ": " << e.what() << "\n";
            }
        }

        std::string query_delete_files = R"(
            DELETE FROM files
            WHERE (is_upload_complete = FALSE AND created_at < NOW() - INTERVAL '4 hours')
               OR (deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days')
        )";
        W.exec(query_delete_files);

        std::string query_delete_folders = R"(
            DELETE FROM folders
            WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days'
        )";
        W.exec(query_delete_folders);

        W.commit();

    } catch (const std::exception& e) {
        std::cerr << "GC: Erro critico durante limpeza: " << e.what() << "\n";
    }
}
