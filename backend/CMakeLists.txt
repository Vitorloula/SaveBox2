cmake_minimum_required(VERSION 3.15)
project(SaveBoxWeb VERSION 2.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ----------------------------------------------------------------------
# FASE 1: DEPENDÊNCIAS DO SISTEMA
# ----------------------------------------------------------------------
find_package(Threads REQUIRED)
find_package(PkgConfig REQUIRED)
find_package(OpenSSL REQUIRED)

# Nossas bibliotecas de produção
pkg_check_modules(PQXX REQUIRED libpqxx)
pkg_check_modules(SODIUM REQUIRED libsodium)
pkg_check_modules(ZIP REQUIRED libzip)

# O nosso framework de testes (Catch2) e o nosso cliente HTTP (CPR)
find_package(Catch2 3 CONFIG REQUIRED)
find_package(cpr REQUIRED)


# ----------------------------------------------------------------------
# FASE 2: SEPARANDO O CÓDIGO FONTE
# ----------------------------------------------------------------------
file(GLOB_RECURSE ALL_SRC_FILES "src/*.cpp")
list(REMOVE_ITEM ALL_SRC_FILES "${CMAKE_CURRENT_SOURCE_DIR}/src/main.cpp")
set(CORE_SOURCES ${ALL_SRC_FILES})

file(GLOB_RECURSE TEST_FILES "tests/*.cpp")


# ----------------------------------------------------------------------
# FASE 3: CONSTRUINDO O SERVIDOR (Produção)
# ----------------------------------------------------------------------
add_executable(savebox_server src/main.cpp ${CORE_SOURCES})

target_include_directories(savebox_server PRIVATE include ${PQXX_INCLUDE_DIRS} ${SODIUM_INCLUDE_DIRS} ${ZIP_INCLUDE_DIRS})
target_link_directories(savebox_server PRIVATE ${PQXX_LIBRARY_DIRS} ${SODIUM_LIBRARY_DIRS} ${ZIP_LIBRARY_DIRS})

target_link_libraries(savebox_server PRIVATE
    Threads::Threads
    ${PQXX_LIBRARIES}
    ${SODIUM_LIBRARIES}
    ${ZIP_LIBRARIES}
    OpenSSL::SSL
    OpenSSL::Crypto
    ws2_32
    mswsock
    crypt32
    bcrypt
    cpr::cpr
)

# ----------------------------------------------------------------------
# FASE 4: CONSTRUINDO OS TESTES (Laboratório)
# ----------------------------------------------------------------------
add_executable(savebox_tests ${TEST_FILES} ${CORE_SOURCES})

target_include_directories(savebox_tests PRIVATE include tests ${PQXX_INCLUDE_DIRS} ${SODIUM_INCLUDE_DIRS} ${ZIP_INCLUDE_DIRS})
target_link_directories(savebox_tests PRIVATE ${PQXX_LIBRARY_DIRS} ${SODIUM_LIBRARY_DIRS} ${ZIP_LIBRARY_DIRS})

target_link_libraries(savebox_tests PRIVATE
    Threads::Threads
    Catch2::Catch2
    ${PQXX_LIBRARIES}
    ${SODIUM_LIBRARIES}
    ${ZIP_LIBRARIES}
    OpenSSL::SSL
    OpenSSL::Crypto
    ws2_32
    mswsock
    crypt32
    bcrypt
    cpr::cpr
)