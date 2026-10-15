cmake_minimum_required(VERSION 3.16)

project(anagrammi_cpp LANGUAGES C CXX)

add_library(utf8proc STATIC third_party/utf8proc/utf8proc.c)
target_include_directories(utf8proc PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/third_party/utf8proc)
target_compile_definitions(utf8proc PUBLIC UTF8PROC_STATIC)

set(ANAGRAMMI_CORE_SOURCES
    core/testo.cpp
    core/unicode.cpp
    core/sillabe.cpp
    core/sha256.cpp
    core/runtime_sillabe.cpp
    core/profilo_sillabe.cpp
    core/vocabolario.cpp
    core/ordinamento_rimario.cpp
    core/ricerche.cpp
    core/comandi.cpp
    core/api.cpp
)

add_library(anagrammi_core STATIC ${ANAGRAMMI_CORE_SOURCES})
target_compile_features(anagrammi_core PUBLIC cxx_std_17)
target_include_directories(anagrammi_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/core)
target_link_libraries(anagrammi_core PUBLIC utf8proc)

add_executable(anagrammi_cpp
    console/main.cpp
    console/vocabolario_file.cpp
)
target_compile_features(anagrammi_cpp PRIVATE cxx_std_17)
target_link_libraries(anagrammi_cpp PRIVATE anagrammi_core)

add_executable(ordina_vocabolario tools/ordina_vocabolario.cpp)
target_compile_features(ordina_vocabolario PRIVATE cxx_std_17)
target_link_libraries(ordina_vocabolario PRIVATE anagrammi_core)

include(CTest)
if(BUILD_TESTING)
    add_executable(ordinamento_rimario_test tests/ordinamento_rimario_test.cpp)
    target_compile_features(ordinamento_rimario_test PRIVATE cxx_std_17)
    target_link_libraries(ordinamento_rimario_test PRIVATE anagrammi_core)
    add_test(NAME ordinamento_rimario COMMAND ordinamento_rimario_test)

    add_executable(vocabolario_personale_test tests/vocabolario_personale_test.cpp)
    target_compile_features(vocabolario_personale_test PRIVATE cxx_std_17)
    target_link_libraries(vocabolario_personale_test PRIVATE anagrammi_core)
    add_test(NAME vocabolario_personale COMMAND vocabolario_personale_test)

    add_executable(unicode_test tests/unicode_test.cpp)
    target_compile_features(unicode_test PRIVATE cxx_std_17)
    target_link_libraries(unicode_test PRIVATE anagrammi_core)
    add_test(NAME unicode COMMAND unicode_test)

    add_executable(sillabe_test tests/sillabe_test.cpp)
    target_compile_features(sillabe_test PRIVATE cxx_std_17)
    target_link_libraries(sillabe_test PRIVATE anagrammi_core)
    add_test(NAME sillabe COMMAND sillabe_test)

    add_executable(runtime_sillabe_test tests/runtime_sillabe_test.cpp)
    target_compile_features(runtime_sillabe_test PRIVATE cxx_std_17)
    target_link_libraries(runtime_sillabe_test PRIVATE anagrammi_core)
    add_test(NAME runtime_sillabe COMMAND runtime_sillabe_test)
endif()
