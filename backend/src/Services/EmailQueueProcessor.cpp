#include "Services/EmailQueueProcessor.hpp"
#include <pqxx/pqxx>
#include <iostream>

EmailQueueProcessor::EmailQueueProcessor(DatabasePool& pool, EmailService& email_service, 
                                         std::chrono::milliseconds interval)
    : pool_(pool), email_service_(email_service), interval_(interval),
      running_(false), should_stop_(false) {}

EmailQueueProcessor::~EmailQueueProcessor() {
    stop();
}

void EmailQueueProcessor::start() {
    if (running_) return;

    running_ = true;
    should_stop_ = false;
    worker_thread_ = std::thread(&EmailQueueProcessor::process_loop, this);
    std::cout << "[EmailQueueProcessor] Thread de background iniciada.\n";
}

void EmailQueueProcessor::stop() {
    if (!running_) return;

    should_stop_ = true;
    cv_.notify_all();

    if (worker_thread_.joinable()) {
        worker_thread_.join();
    }
    running_ = false;
    std::cout << "[EmailQueueProcessor] Thread de background parada.\n";
}

void EmailQueueProcessor::process_loop() {
    while (!should_stop_) {
        try {
            process_pending_emails();
        } catch (const std::exception& e) {
            std::cerr << "[EmailQueueProcessor] Erro no loop de processamento: " << e.what() << "\n";
        }

        std::unique_lock<std::mutex> lock(cv_mutex_);
        if (cv_.wait_for(lock, interval_, [this] { return should_stop_.load(); })) {
            break;
        }
    }
}

void EmailQueueProcessor::process_pending_emails() {
    auto conn = pool_.acquire_connection();
    
    struct EmailJob {
        int64_t id;
        std::string to_email;
        std::string token;
        int attempts;
    };
    
    std::vector<EmailJob> jobs;

    {
        pqxx::work txn(*conn);
        // Atualiza atomicamente os e-mails para 'PROCESSING' usando FOR UPDATE SKIP LOCKED
        auto result = txn.exec(R"(
            UPDATE email_queue
            SET status = 'PROCESSING', updated_at = NOW()
            WHERE id IN (
                SELECT id FROM email_queue
                WHERE status = 'PENDING' OR (status = 'FAILED' AND attempts < 3)
                ORDER BY id ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 5
            )
            RETURNING id, to_email, verification_token, attempts;
        )");
        
        for (const auto& row : result) {
            jobs.push_back({
                row[0].as<int64_t>(),
                row[1].as<std::string>(),
                row[2].as<std::string>(),
                row[3].as<int>()
            });
        }
        
        txn.commit();
    }

    if (jobs.empty()) {
        return;
    }

    std::cout << "[EmailQueueProcessor] Processando " << jobs.size() << " e-mails pendentes...\n";

    for (const auto& job : jobs) {
        bool success = false;
        std::string last_error;

        try {
            success = email_service_.send_verification_email(job.to_email, job.token);
            if (!success) {
                last_error = "Falha no envio (EmailService retornou falso)";
            }
        } catch (const std::exception& e) {
            last_error = std::string("Excecao disparada: ") + e.what();
        }

        // Grava o resultado da execução em uma nova transação
        try {
            pqxx::work txn(*conn);
            if (success) {
                std::cout << "[EmailQueueProcessor] E-mail enviado com sucesso para: " << job.to_email << "\n";
                txn.exec(
                    "UPDATE email_queue SET status = 'SENT', updated_at = NOW() WHERE id = $1",
                    pqxx::params{job.id}
                );
            } else {
                std::cerr << "[EmailQueueProcessor] Falha ao enviar para " << job.to_email 
                          << ". Erro: " << last_error << "\n";
                
                int new_attempts = job.attempts + 1;
                std::string new_status = (new_attempts >= 3) ? "FAILED" : "PENDING";
                
                txn.exec(
                    "UPDATE email_queue "
                    "SET status = $1, attempts = $2, last_error = $3, updated_at = NOW() "
                    "WHERE id = $4",
                    pqxx::params{new_status, new_attempts, last_error, job.id}
                );
            }
            txn.commit();
        } catch (const std::exception& e) {
            std::cerr << "[EmailQueueProcessor] Falha ao atualizar status do job " << job.id 
                      << ": " << e.what() << "\n";
        }
    }
}
