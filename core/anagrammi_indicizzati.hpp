#ifndef ANAGRAMMI_ANAGRAMMI_INDICIZZATI_HPP
#define ANAGRAMMI_ANAGRAMMI_INDICIZZATI_HPP

#include "vocabolario.hpp"
#include "runtime_sillabe.hpp"
#include "profilo_sillabe.hpp"

#include <cstddef>
#include <string>
#include <stdexcept>
#include <vector>

namespace anagrammi {
namespace dettaglio {

struct CandidatoAnagramma {
    std::size_t indice_vocabolario;
    std::string lettere_non_usate;
};

using CandidatiAnagrammi = std::vector<CandidatoAnagramma>;
using CandidatoRicerca = CandidatoAnagramma;
using CandidatiRicerca = CandidatiAnagrammi;

CandidatiAnagrammi cerca_anagrammi_indicizzati(
    const Words& vocabulary, const std::string& searched, std::size_t wanted_length);

// I candidati si riferiscono allo stesso vocabolario, non modificato dalla ricerca.
Words formatta_anagrammi(const Words& vocabulary, const CandidatiAnagrammi& candidati);

CandidatiRicerca sostituisci_punti_interrogativi_indicizzati(
    const Words& vocabulary, const std::string& pattern);
CandidatiRicerca cerca_con_jolly_indicizzati(const Words& vocabulary, const std::string& pattern);
CandidatiRicerca parole_con_tutte_le_lettere_indicizzate(const Words& vocabulary, std::string searched);
CandidatiRicerca parole_senza_lettere_indicizzate(const Words& vocabulary, std::string searched);
CandidatiRicerca parole_formabili_da_lettere_indicizzate(const Words& vocabulary, std::string searched);
CandidatiRicerca parole_casuali_indicizzate(
    const Words& vocabulary, const std::string& command, std::string& footer,
    const RuntimeSillabe* runtime = nullptr, const FiltroSillabe* filtro = nullptr,
    bool* ricerca_valida = nullptr, const ProfiloSillabePersonale* personale = nullptr);

// Il chiamante deve associare runtime e vocabolario allo stesso snapshot.
// La sola uguaglianza del numero di grafie non dimostra tale identita.
inline CandidatiAnagrammi filtra_candidati_per_sillabe(
    const CandidatiAnagrammi& candidati, const RuntimeSillabe& runtime, const FiltroSillabe& filtro) {
    CandidatiAnagrammi filtrati;
    filtrati.reserve(candidati.size());
    for (const auto& candidato : candidati) {
        if (runtime.compatibile(candidato.indice_vocabolario, filtro)) {
            filtrati.push_back(candidato);
        }
    }
    return filtrati;
}

inline CandidatiRicerca applica_filtro_sillabe_opzionale(
    CandidatiRicerca candidati, const RuntimeSillabe* runtime, const FiltroSillabe* filtro,
    const ProfiloSillabePersonale* personale = nullptr) {
    if (!filtro) {
        return candidati;
    }
    if (personale) {
        CandidatiRicerca filtrati;
        filtrati.reserve(candidati.size());
        for (const auto& candidato : candidati) {
            if (personale->compatibile(candidato.indice_vocabolario, *filtro)) filtrati.push_back(candidato);
        }
        return filtrati;
    }
    if (!runtime) {
        throw std::logic_error("Filtro sillabico: nessun RuntimeSillabe compatibile associato");
    }
    return filtra_candidati_per_sillabe(candidati, *runtime, *filtro);
}

} // namespace dettaglio
} // namespace anagrammi

#endif
