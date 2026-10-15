#include "../core/api.hpp"
#include "../core/sillabe.hpp"

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string_view>
#include <utility>
#include <vector>

namespace {

enum class ModalitaFiltroSillabe { esattamente, almeno, al_massimo, tra };

std::vector<std::uint8_t> copia_bytes(emscripten::val input) {
    if (!input.instanceof(emscripten::val::global("Uint8Array"))) {
        throw std::invalid_argument("Sono richiesti byte Uint8Array, non una stringa");
    }
    // L'allocazione puo' far crescere la memoria WASM e invalidare una sua vista JS.
    const emscripten::val memoria(emscripten::typed_memory_view(
        0, static_cast<std::uint8_t*>(nullptr)));
    if (input["buffer"].strictlyEquals(memoria["buffer"])) {
        input = input.call<emscripten::val>("slice");
    }
    std::vector<std::uint8_t> bytes(input["byteLength"].as<std::size_t>());
    if (!bytes.empty()) {
        emscripten::val(emscripten::typed_memory_view(bytes.size(), bytes.data()))
            .call<void>("set", input);
    }
    return bytes;
}

void carica_vocabolario_da_bytes(anagrammi::MotoreAnagrammi& motore, emscripten::val input) {
    const auto bytes = copia_bytes(std::move(input));
    motore.carica_vocabolario_ordinato_con_identita(std::string_view(
        reinterpret_cast<const char*>(bytes.data()), bytes.size()));
}

void associa_runtime_da_bytes(anagrammi::MotoreAnagrammi& motore, emscripten::val input,
                             const std::string& artifact_sha256_atteso) {
    if (artifact_sha256_atteso.size() != 64 ||
        !std::all_of(artifact_sha256_atteso.begin(), artifact_sha256_atteso.end(), [](char c) {
            return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
        })) {
        throw std::invalid_argument("SHA-256 artifact obbligatorio: 64 cifre esadecimali minuscole");
    }
    anagrammi::VerificheRuntimeSillabe verifiche;
    verifiche.artifact_sha256 = artifact_sha256_atteso;
    anagrammi::RuntimeSillabe runtime(copia_bytes(std::move(input)), verifiche);
    motore.associa_runtime_sillabe(std::move(runtime));
}

std::uint64_t intero_da_js(double numero) {
    if (!std::isfinite(numero) || numero < 0 || std::floor(numero) != numero ||
        numero > 9007199254740991.0) {
        throw std::invalid_argument("Numero sillabe: richiesto un intero JavaScript sicuro non negativo");
    }
    return static_cast<std::uint64_t>(numero);
}

anagrammi::FiltroSillabe crea_filtro(ModalitaFiltroSillabe modalita, double minimo, double massimo) {
    using anagrammi::FiltroSillabe;
    switch (modalita) {
    case ModalitaFiltroSillabe::esattamente:
        return FiltroSillabe::esattamente(intero_da_js(minimo));
    case ModalitaFiltroSillabe::almeno:
        return FiltroSillabe::almeno(intero_da_js(minimo));
    case ModalitaFiltroSillabe::al_massimo:
        return FiltroSillabe::al_massimo(intero_da_js(minimo));
    case ModalitaFiltroSillabe::tra:
        return FiltroSillabe::tra(intero_da_js(minimo), intero_da_js(massimo));
    }
    throw std::invalid_argument("Modalita' filtro sillabico non valida");
}

anagrammi::FiltroSillabe filtro_da_js(
    emscripten::val modalita, double minimo, double massimo) {
    const auto valori = emscripten::val::module_property("ModalitaFiltroSillabe");
    if (!modalita.strictlyEquals(valori["ESATTAMENTE"]) &&
        !modalita.strictlyEquals(valori["ALMENO"]) &&
        !modalita.strictlyEquals(valori["AL_MASSIMO"]) &&
        !modalita.strictlyEquals(valori["TRA"])) {
        throw std::invalid_argument("Usare un valore di ModalitaFiltroSillabe");
    }
    return crea_filtro(modalita.as<ModalitaFiltroSillabe>(), minimo, massimo);
}

anagrammi::RisultatoComando esegui_comando_filtrato(
    anagrammi::MotoreAnagrammi& motore, const std::string& comando,
    emscripten::val modalita, double minimo, double massimo) {
    return motore.esegui_comando_con_filtro_sillabe(
        comando, filtro_da_js(std::move(modalita), minimo, massimo));
}

anagrammi::SintesiRisultato avvia_comando_paginato_filtrato(
    anagrammi::MotoreAnagrammi& motore, const std::string& comando,
    emscripten::val modalita, double minimo, double massimo) {
    return motore.avvia_comando_paginato_con_filtro_sillabe(
        comando, filtro_da_js(std::move(modalita), minimo, massimo));
}

double intero_pagina_da_js(const emscripten::val& input, double minimo,
                          double massimo, const char* nome) {
    if (input.typeOf().as<std::string>() != "number") {
        throw std::invalid_argument(std::string(nome) + ": richiesto un Number JavaScript");
    }
    const double numero = input.as<double>();
    if (!std::isfinite(numero) || std::floor(numero) != numero ||
        numero < minimo || numero > massimo) {
        throw std::invalid_argument(std::string(nome) + ": intero fuori range");
    }
    return numero;
}

std::uint32_t id_snapshot_da_js(const emscripten::val& input) {
    return static_cast<std::uint32_t>(intero_pagina_da_js(
        input, 1, std::numeric_limits<std::uint32_t>::max(), "id_snapshot"));
}

anagrammi::PaginaRisultato leggi_pagina_risultato(
    const anagrammi::MotoreAnagrammi& motore, emscripten::val id,
    emscripten::val offset, emscripten::val limite) {
    const auto id_validato = id_snapshot_da_js(id);
    const auto offset_validato = static_cast<std::size_t>(intero_pagina_da_js(
        offset, 0, std::numeric_limits<std::size_t>::max(), "offset"));
    const auto limite_validato = static_cast<std::size_t>(intero_pagina_da_js(
        limite, 0, std::numeric_limits<std::size_t>::max(), "limite"));
    return motore.leggi_pagina_risultato(id_validato, offset_validato, limite_validato);
}

void libera_risultato(anagrammi::MotoreAnagrammi& motore, emscripten::val id) {
    motore.libera_risultato(id_snapshot_da_js(id));
}

std::size_t conta_sillabe_wasm(const std::string& parola) {
    return anagrammi::conta_sillabe(parola);
}

} // namespace

EMSCRIPTEN_BINDINGS(anagrammi_module) {
    emscripten::enum_<ModalitaFiltroSillabe>("ModalitaFiltroSillabe")
        .value("ESATTAMENTE", ModalitaFiltroSillabe::esattamente)
        .value("ALMENO", ModalitaFiltroSillabe::almeno)
        .value("AL_MASSIMO", ModalitaFiltroSillabe::al_massimo)
        .value("TRA", ModalitaFiltroSillabe::tra);
    emscripten::function("conta_sillabe", &conta_sillabe_wasm);
    emscripten::register_vector<std::string>("StringVector");

    emscripten::value_object<anagrammi::RisultatoComando>("RisultatoComando")
        .field("tipo", &anagrammi::RisultatoComando::tipo)
        .field("righe", &anagrammi::RisultatoComando::righe)
        .field("parole_vocabolario", &anagrammi::RisultatoComando::parole_vocabolario)
        .field("footer", &anagrammi::RisultatoComando::footer)
        .field("messaggio", &anagrammi::RisultatoComando::messaggio)
        .field("parola_modificata", &anagrammi::RisultatoComando::parola_modificata)
        .field("vocabolario_modificato", &anagrammi::RisultatoComando::vocabolario_modificato)
        .field("richiede_salvataggio", &anagrammi::RisultatoComando::richiede_salvataggio);

    emscripten::value_object<anagrammi::SintesiRisultato>("SintesiRisultato")
        .field("id_snapshot", &anagrammi::SintesiRisultato::id_snapshot)
        .field("ha_snapshot", &anagrammi::SintesiRisultato::ha_snapshot)
        .field("totale", &anagrammi::SintesiRisultato::totale)
        .field("tipo", &anagrammi::SintesiRisultato::tipo)
        .field("footer", &anagrammi::SintesiRisultato::footer)
        .field("messaggio", &anagrammi::SintesiRisultato::messaggio)
        .field("parola_modificata", &anagrammi::SintesiRisultato::parola_modificata)
        .field("vocabolario_modificato", &anagrammi::SintesiRisultato::vocabolario_modificato)
        .field("richiede_salvataggio", &anagrammi::SintesiRisultato::richiede_salvataggio);

    emscripten::value_object<anagrammi::PaginaRisultato>("PaginaRisultato")
        .field("id_snapshot", &anagrammi::PaginaRisultato::id_snapshot)
        .field("offset", &anagrammi::PaginaRisultato::offset)
        .field("count", &anagrammi::PaginaRisultato::count)
        .field("righe", &anagrammi::PaginaRisultato::righe)
        .field("parole_vocabolario", &anagrammi::PaginaRisultato::parole_vocabolario);

    emscripten::class_<anagrammi::MotoreAnagrammi>("MotoreAnagrammi")
        .constructor<>()
        .function("carica_vocabolario_da_testo", &anagrammi::MotoreAnagrammi::carica_vocabolario_da_testo)
        .function("carica_vocabolario_ordinato_da_testo", &anagrammi::MotoreAnagrammi::carica_vocabolario_ordinato_da_testo)
        .function("carica_vocabolario_ordinato_con_identita_da_bytes", &carica_vocabolario_da_bytes)
        .function("associa_runtime_sillabe_da_bytes", &associa_runtime_da_bytes)
        .function("prepara_sillabe_personali", &anagrammi::MotoreAnagrammi::prepara_sillabe_personali)
        .function("prepara_sillabe_personali_da_ufficiale", &anagrammi::MotoreAnagrammi::prepara_sillabe_personali_da_ufficiale)
        .function("ha_profilo_sillabe_personale", &anagrammi::MotoreAnagrammi::ha_profilo_sillabe_personale)
        .function("applica_modifiche", &anagrammi::MotoreAnagrammi::applica_modifiche)
        .function("numero_parole", &anagrammi::MotoreAnagrammi::numero_parole)
        .function("esporta_vocabolario_testo", &anagrammi::MotoreAnagrammi::esporta_vocabolario_testo)
        .function("imposta_sola_lettura", &anagrammi::MotoreAnagrammi::imposta_sola_lettura)
        .function("sola_lettura", &anagrammi::MotoreAnagrammi::sola_lettura)
        .function("esegui_comando", &anagrammi::MotoreAnagrammi::esegui_comando)
        .function("esegui_comando_con_filtro_sillabe", &esegui_comando_filtrato)
        .function("avvia_comando_paginato", &anagrammi::MotoreAnagrammi::avvia_comando_paginato)
        .function("avvia_comando_paginato_con_filtro_sillabe", &avvia_comando_paginato_filtrato)
        .function("leggi_pagina_risultato", &leggi_pagina_risultato)
        .function("libera_risultato", &libera_risultato)
        .function("esegui_comando_testo", &anagrammi::MotoreAnagrammi::esegui_comando_testo)
        .function("aggiungi_parola", &anagrammi::MotoreAnagrammi::aggiungi_parola)
        .function("rimuovi_parola", &anagrammi::MotoreAnagrammi::rimuovi_parola);
}
