#pragma once

#include "database/DatabasePool.hpp"
#include "Services/EmailService.hpp"
#include <thread>
#include <atomic>
#include <mutex>
#include <condition_variable>
#include <chrono>

class EmailQueueProcessor {
public:
    EmailQueueProcessor(DatabasePool& pool, EmailService& email_service, 
                        std::chrono::milliseconds interval = std::chrono::seconds(5));
    ~EmailQueueProcessor();

    void start();
    void stop();
    bool is_running() const { return running_; }

    // Allows manual triggering/processing, very useful for tests and demonstrations.
    void process_pending_emails();

private:
    void process_loop();

    DatabasePool& pool_;
    EmailService& email_service_;
    std::chrono::milliseconds interval_;

    std::thread worker_thread_;
    std::atomic<bool> running_;
    std::atomic<bool> should_stop_;

    std::mutex cv_mutex_;
    std::condition_variable cv_;
};
