cmake_minimum_required(VERSION 3.22.1)
project(bsnode C CXX)
set(LIBNODE ${CMAKE_SOURCE_DIR}/../../../libnode)
set(SQLITE ${CMAKE_SOURCE_DIR}/../../../sqlite)
set(SHARED ${CMAKE_SOURCE_DIR}/../../../../../shared)

# SQLite (Amalgamation, scripts/fetch-deps.sh) + N-API-Modul bookshelv_sqlite (native/shared/sqlite_napi.c).
# Das Modul registriert sich beim Laden der Bibliothek (Konstruktor) als „linked binding“ – vor dem Start von Node.
add_library(bsnode SHARED native-lib.cpp ${SHARED}/sqlite_napi.c ${SQLITE}/sqlite3.c)
target_include_directories(bsnode PRIVATE ${LIBNODE}/include/node ${SQLITE})
target_compile_definitions(bsnode PRIVATE NAPI_VERSION=8
  SQLITE_DQS=0 SQLITE_THREADSAFE=1 SQLITE_DEFAULT_MEMSTATUS=0 SQLITE_OMIT_DEPRECATED SQLITE_OMIT_LOAD_EXTENSION
  SQLITE_ENABLE_FTS5 SQLITE_TEMP_STORE=2)
set_source_files_properties(${SQLITE}/sqlite3.c PROPERTIES COMPILE_OPTIONS "-O2;-Wno-everything")
add_library(libnode SHARED IMPORTED)
set_target_properties(libnode PROPERTIES IMPORTED_LOCATION ${LIBNODE}/bin/${ANDROID_ABI}/libnode.so)
find_library(log-lib log)
target_link_libraries(bsnode libnode ${log-lib})
