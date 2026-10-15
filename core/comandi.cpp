#include "comandi.hpp"

#include "ricerche.hpp"
#include "testo.hpp"
#include "unicode.hpp"

#include <sstream>
#include <utility>

namespace anagrammi {

namespace dettaglio {

RisultatoRicercaIndicizzata esegui_ricerca_indicizzata(
    const Words& vocabulary, const std::string& raw_input,
    const RuntimeSillabe* runtime, const FiltroSillabe* filtro,
    const ProfiloSillabePersonale* personale) {
    const std::string input = normalizza_testo(raw_input);
    RisultatoRicercaIndicizzata result;

    if (contiene(input, '%')) {
        result.footer = "Comando non disponibile.";
        result.paginabile = false;
        return result;
    } else if (contiene(input, '*')) {
        result.candidati = cerca_con_jolly_indicizzati(vocabulary, input);
    } else if (contiene(input, '?')) {
        result.candidati = sostituisci_punti_interrogativi_indicizzati(vocabulary, input);
    } else if (contiene(input, '&')) {
        result.candidati = parole_con_tutte_le_lettere_indicizzate(vocabulary, input);
    } else if (contiene(input, '!')) {
        result.candidati = parole_senza_lettere_indicizzate(vocabulary, input);
    } else if (contiene(input, '$')) {
        result.candidati = parole_formabili_da_lettere_indicizzate(vocabulary, input);
    } else if (contiene(input, '^')) {
        // Il bacino viene filtrato prima delle estrazioni, non il risultato casuale.
        result.candidati = parole_casuali_indicizzate(
            vocabulary, input, result.footer, runtime, filtro, &result.paginabile, personale);
        return result;
    } else {
        std::stringstream ss(input);
        std::string word;
        std::size_t wanted_length = 0;
        ss >> word;
        if (!(ss >> wanted_length)) {
            wanted_length = lunghezza_utf8(word);
        }
        result.candidati = cerca_anagrammi_indicizzati(vocabulary, word, wanted_length);
    }

    result.candidati = applica_filtro_sillabe_opzionale(std::move(result.candidati), runtime, filtro, personale);
    result.footer = "- " + std::to_string(result.candidati.size()) + " corrispondenze -";
    return result;
}

} // namespace dettaglio

RisultatoRicerca esegui_ricerca(const Words& vocabulary, const std::string& input) {
    const auto result = dettaglio::esegui_ricerca_indicizzata(vocabulary, input);
    return {dettaglio::formatta_anagrammi(vocabulary, result.candidati), result.footer};
}

} // namespace anagrammi
