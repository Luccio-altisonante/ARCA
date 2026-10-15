#include "vocabolario.hpp"

#include "ordinamento_rimario.hpp"
#include "testo.hpp"

#include <algorithm>

namespace anagrammi {

Words normalizza_vocabolario(const Words& words) {
    Words normalized;
    normalized.reserve(words.size());

    for (const auto& word : words) {
        std::string normalized_word = normalizza_testo(word);
        if (!normalized_word.empty()) {
            normalized.push_back(normalized_word);
        }
    }

    return normalized;
}

bool aggiungi_parola(Words& vocabulary, const std::string& word) {
    if (!e_ordinato_rimario(vocabulary)) {
        ordina_rimario(vocabulary);
    }
    return inserisci_parola_ordinata(vocabulary, word);
}

bool inserisci_parola_ordinata(Words& vocabulary, const std::string& word) {
    if (word.empty() || std::find(vocabulary.begin(), vocabulary.end(), word) != vocabulary.end()) {
        return false;
    }

    const auto posizione = std::lower_bound(
        vocabulary.begin(), vocabulary.end(), word,
        [](const std::string& sinistra, const std::string& destra) {
            return rimario_less(sinistra, destra);
        });
    vocabulary.insert(posizione, word);
    return true;
}

bool rimuovi_parola(Words& vocabulary, const std::string& word) {
    const auto old_size = vocabulary.size();
    vocabulary.erase(std::remove(vocabulary.begin(), vocabulary.end(), word), vocabulary.end());
    return vocabulary.size() != old_size;
}

} // namespace anagrammi
