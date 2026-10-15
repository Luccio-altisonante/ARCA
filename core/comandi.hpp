#ifndef ANAGRAMMI_COMANDI_HPP
#define ANAGRAMMI_COMANDI_HPP

#include "vocabolario.hpp"
#include "anagrammi_indicizzati.hpp"

#include <string>

namespace anagrammi {

struct RisultatoRicerca {
    Words risultati;
    std::string footer;
};

RisultatoRicerca esegui_ricerca(const Words& vocabulary, const std::string& input);

namespace dettaglio {

struct RisultatoRicercaIndicizzata {
    CandidatiRicerca candidati;
    std::string footer;
    bool paginabile = true;
};

RisultatoRicercaIndicizzata esegui_ricerca_indicizzata(
    const Words& vocabulary, const std::string& input,
    const RuntimeSillabe* runtime = nullptr, const FiltroSillabe* filtro = nullptr,
    const ProfiloSillabePersonale* personale = nullptr);

} // namespace dettaglio

} // namespace anagrammi

#endif
