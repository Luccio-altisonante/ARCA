#include "ricerche.hpp"

#include "anagrammi_indicizzati.hpp"
#include "testo.hpp"
#include "unicode.hpp"

#include <algorithm>
#include <cstdint>
#include <random>
#include <set>
#include <stdexcept>
#include <utility>

namespace anagrammi {

namespace {

bool rimuovi_prima(std::u32string& testo, char32_t carattere) {
    const auto posizione = testo.find(carattere);
    if (posizione == std::u32string::npos) {
        return false;
    }
    testo.erase(posizione, 1);
    return true;
}

void rimuovi_tutti(std::u32string& testo, char32_t carattere) {
    testo.erase(std::remove(testo.begin(), testo.end(), carattere), testo.end());
}

bool jolly_corrisponde(const std::u32string& pattern, const std::u32string& parola) {
    std::size_t posizione_pattern = 0;
    std::size_t posizione_parola = 0;
    std::size_t posizione_asterisco = std::u32string::npos;
    std::size_t nuovo_tentativo = 0;

    while (posizione_parola < parola.size()) {
        if (posizione_pattern < pattern.size() &&
            (pattern[posizione_pattern] == U'?' ||
             pattern[posizione_pattern] == parola[posizione_parola])) {
            ++posizione_pattern;
            ++posizione_parola;
        } else if (posizione_pattern < pattern.size() && pattern[posizione_pattern] == U'*') {
            posizione_asterisco = posizione_pattern++;
            nuovo_tentativo = posizione_parola;
        } else if (posizione_asterisco != std::u32string::npos) {
            posizione_pattern = posizione_asterisco + 1;
            posizione_parola = ++nuovo_tentativo;
        } else {
            return false;
        }
    }

    while (posizione_pattern < pattern.size() && pattern[posizione_pattern] == U'*') {
        ++posizione_pattern;
    }
    return posizione_pattern == pattern.size();
}

} // namespace

namespace dettaglio {

CandidatiAnagrammi cerca_anagrammi_indicizzati(
    const Words& vocabulary, const std::string& searched, std::size_t wanted_length) {
    CandidatiAnagrammi results;
    const std::u32string lettere_cercate = decodifica_utf8(searched);
    const std::size_t original_length = lettere_cercate.size();

    for (std::size_t indice = 0; indice < vocabulary.size(); ++indice) {
        const auto& word = vocabulary[indice];
        const std::u32string parola = decodifica_utf8(word);
        if (parola.size() != wanted_length) {
            continue;
        }

        std::u32string lettere_rimanenti = parola;
        for (char32_t lettera : lettere_cercate) {
            rimuovi_prima(lettere_rimanenti, lettera);
        }

        if (lettere_rimanenti.empty()) {
            if (wanted_length < original_length) {
                std::u32string non_usate = lettere_cercate;
                for (char32_t lettera : parola) {
                    rimuovi_prima(non_usate, lettera);
                }
                results.push_back({indice, codifica_utf8(non_usate)});
            } else {
                results.push_back({indice, {}});
            }
        }
    }
    return results;
}

Words formatta_anagrammi(const Words& vocabulary, const CandidatiAnagrammi& candidati) {
    Words results;
    results.reserve(candidati.size());
    for (const auto& candidato : candidati) {
        const auto& word = vocabulary.at(candidato.indice_vocabolario);
        if (candidato.lettere_non_usate.empty()) {
            results.push_back(word);
        } else {
            results.push_back(word + "   [-" + candidato.lettere_non_usate + "]");
        }
    }
    return results;
}

} // namespace dettaglio

Words cerca_anagrammi(const Words& vocabulary, const std::string& searched, std::size_t wanted_length) {
    const auto candidati = dettaglio::cerca_anagrammi_indicizzati(vocabulary, searched, wanted_length);
    return dettaglio::formatta_anagrammi(vocabulary, candidati);
}

namespace dettaglio {

CandidatiRicerca sostituisci_punti_interrogativi_indicizzati(const Words& vocabulary, const std::string& pattern) {
    CandidatiRicerca results;
    const std::u32string pattern_unicode = decodifica_utf8(pattern);

    for (std::size_t indice_vocabolario = 0; indice_vocabolario < vocabulary.size(); ++indice_vocabolario) {
        const auto& word = vocabulary[indice_vocabolario];
        const std::u32string parola = decodifica_utf8(word);
        if (parola.size() != pattern_unicode.size()) {
            continue;
        }

        bool corrisponde = true;
        for (std::size_t indice = 0; indice < pattern_unicode.size(); ++indice) {
            if (pattern_unicode[indice] != U'?' && pattern_unicode[indice] != parola[indice]) {
                corrisponde = false;
                break;
            }
        }
        if (corrisponde) {
            results.push_back({indice_vocabolario, {}});
        }
    }
    return results;
}

CandidatiRicerca cerca_con_jolly_indicizzati(const Words& vocabulary, const std::string& pattern) {
    CandidatiRicerca results;
    const std::u32string pattern_unicode = decodifica_utf8(pattern);
    for (std::size_t indice = 0; indice < vocabulary.size(); ++indice) {
        const auto& word = vocabulary[indice];
        if (jolly_corrisponde(pattern_unicode, decodifica_utf8(word))) {
            results.push_back({indice, {}});
        }
    }
    return results;
}

CandidatiRicerca parole_con_tutte_le_lettere_indicizzate(const Words& vocabulary, std::string searched) {
    CandidatiRicerca results;
    std::u32string cercate = decodifica_utf8(searched);
    rimuovi_tutti(cercate, U'&');

    for (std::size_t indice = 0; indice < vocabulary.size(); ++indice) {
        const auto& word = vocabulary[indice];
        std::u32string rimanenti = cercate;
        for (char32_t lettera : decodifica_utf8(word)) {
            rimuovi_prima(rimanenti, lettera);
            if (rimanenti.empty()) {
                results.push_back({indice, {}});
                break;
            }
        }
    }
    return results;
}

CandidatiRicerca parole_senza_lettere_indicizzate(const Words& vocabulary, std::string searched) {
    CandidatiRicerca results;
    std::u32string vietate = decodifica_utf8(searched);
    rimuovi_tutti(vietate, U'!');

    for (std::size_t indice = 0; indice < vocabulary.size(); ++indice) {
        const auto& word = vocabulary[indice];
        const std::u32string parola = decodifica_utf8(word);
        const bool contiene_vietata = std::any_of(
            vietate.begin(), vietate.end(), [&parola](char32_t lettera) {
                return parola.find(lettera) != std::u32string::npos;
            });
        if (!contiene_vietata) {
            results.push_back({indice, {}});
        }
    }
    return results;
}

CandidatiRicerca parole_formabili_da_lettere_indicizzate(const Words& vocabulary, std::string searched) {
    CandidatiRicerca results;
    std::u32string disponibili = decodifica_utf8(searched);
    rimuovi_tutti(disponibili, U'$');

    for (std::size_t indice = 0; indice < vocabulary.size(); ++indice) {
        const auto& word = vocabulary[indice];
        const std::u32string parola = decodifica_utf8(word);
        if (parola.size() > disponibili.size()) {
            continue;
        }

        std::u32string rimanenti = parola;
        for (char32_t lettera : disponibili) {
            rimuovi_prima(rimanenti, lettera);
            if (rimanenti.empty()) {
                results.push_back({indice, {}});
                break;
            }
        }
    }
    return results;
}

CandidatiRicerca parole_casuali_indicizzate(
    const Words& vocabulary, const std::string& command, std::string& footer,
    const RuntimeSillabe* runtime, const FiltroSillabe* filtro, bool* ricerca_valida,
    const ProfiloSillabePersonale* personale) {
    if (ricerca_valida) {
        *ricerca_valida = false;
    }
    const auto parts = dividi(command, ',');
    if (parts.size() < 3 || parts[0] != "^") {
        footer = "Uso corretto: ^,quante,caratteri  esempio: ^,10,8";
        return {};
    }

    const auto count = static_cast<std::uint32_t>(std::stoul(parts[1]));
    if (count > massimo_estrazioni_casuali) {
        throw std::invalid_argument("Comando ^: massimo 100000 estrazioni per ricerca.");
    }
    const auto length = static_cast<std::size_t>(std::stoul(parts[2]));
    if (ricerca_valida) {
        *ricerca_valida = true;
    }
    CandidatiRicerca candidates;
    CandidatiRicerca results;

    for (std::size_t indice = 0; indice < vocabulary.size(); ++indice) {
        const auto& word = vocabulary[indice];
        if (lunghezza_utf8(word) == length) {
            candidates.push_back({indice, {}});
        }
    }

    candidates = applica_filtro_sillabe_opzionale(std::move(candidates), runtime, filtro, personale);
    if (candidates.empty()) {
        footer = "- 0 corrispondenze -";
        return {};
    }

    std::mt19937 rng(std::random_device{}());
    std::uniform_int_distribution<std::size_t> distribution(0, candidates.size() - 1);
    for (std::uint32_t i = 0; i < count; ++i) {
        results.push_back(candidates[distribution(rng)]);
    }

    footer = "- " + std::to_string(results.size()) + " parole a caso - su " +
        std::to_string(candidates.size()) + " parole da " + std::to_string(length) + " lettere";
    return results;
}

} // namespace dettaglio

Words sostituisci_punti_interrogativi(const Words& vocabulary, const std::string& pattern) {
    return dettaglio::formatta_anagrammi(vocabulary,
        dettaglio::sostituisci_punti_interrogativi_indicizzati(vocabulary, pattern));
}

Words cerca_con_jolly(const Words& vocabulary, const std::string& pattern) {
    return dettaglio::formatta_anagrammi(vocabulary, dettaglio::cerca_con_jolly_indicizzati(vocabulary, pattern));
}

Words parole_con_tutte_le_lettere(const Words& vocabulary, std::string searched) {
    return dettaglio::formatta_anagrammi(vocabulary,
        dettaglio::parole_con_tutte_le_lettere_indicizzate(vocabulary, std::move(searched)));
}

Words parole_senza_lettere(const Words& vocabulary, std::string searched) {
    return dettaglio::formatta_anagrammi(vocabulary,
        dettaglio::parole_senza_lettere_indicizzate(vocabulary, std::move(searched)));
}

Words parole_formabili_da_lettere(const Words& vocabulary, std::string searched) {
    return dettaglio::formatta_anagrammi(vocabulary,
        dettaglio::parole_formabili_da_lettere_indicizzate(vocabulary, std::move(searched)));
}

Words parole_casuali(const Words& vocabulary, const std::string& command, std::string& footer) {
    return dettaglio::formatta_anagrammi(vocabulary,
        dettaglio::parole_casuali_indicizzate(vocabulary, command, footer));
}

Words password_casuali(const std::string& command, std::string& footer) {
    const auto parts = dividi(command, ',');
    if (parts.size() < 3 || parts[0] != "%") {
        footer = "Uso corretto: %,quante,caratteri  esempio: %,10,100";
        return {};
    }

    const auto count = static_cast<std::uint32_t>(std::stoul(parts[1]));
    const auto length = static_cast<std::size_t>(std::stoul(parts[2]));
    Words results;
    std::set<std::string> seen_passwords;
    std::random_device rng;
    std::uniform_int_distribution<int> printable_ascii(33, 126);

    for (std::uint32_t i = 1; i <= count; ++i) {
        std::string password;
        password.reserve(length);
        while (password.size() < length) {
            password.push_back(static_cast<char>(printable_ascii(rng)));
        }

        results.push_back("---------PASSWORD CRITTOGRAFICA n. " + std::to_string(i) + "---------------------------------------");
        if (seen_passwords.insert(password).second) {
            results.push_back(password);
        }
    }

    const auto duplicates = count - static_cast<std::uint32_t>(seen_passwords.size());
    footer = "---------GENERATE n. " + std::to_string(count) +
        " PASSWORD CRITTOGRAFICHE, ELIMINATI n. " + std::to_string(duplicates) + " DUPLICATI--------";
    return results;
}

} // namespace anagrammi
