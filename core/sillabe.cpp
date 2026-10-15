#include "sillabe.hpp"

#include "unicode.hpp"

#include <algorithm>

namespace anagrammi {

namespace {

enum class Vocale { nessuna, forte, debole, debole_accentata };

Vocale classifica_vocale(char32_t carattere) {
    switch (carattere) {
    case U'a': case U'\u00e0': case U'\u00e1': case U'\u00e2':
    case U'e': case U'\u00e8': case U'\u00e9': case U'\u00ea':
    case U'o': case U'\u00f2': case U'\u00f3': case U'\u00f4':
        return Vocale::forte;
    case U'i': case U'u':
        return Vocale::debole;
    case U'\u00ec': case U'\u00ed': case U'\u00ee':
    case U'\u00f9': case U'\u00fa': case U'\u00fb':
        return Vocale::debole_accentata;
    default:
        return Vocale::nessuna;
    }
}

} // namespace

std::size_t conta_sillabe(std::string_view parola) {
    const auto caratteri = decodifica_utf8(normalizza_unicode(parola));
    std::size_t totale = 0;
    std::size_t nuclei = 0;
    bool nel_gruppo = false;

    for (char32_t carattere : caratteri) {
        const auto vocale = classifica_vocale(carattere);
        if (vocale != Vocale::nessuna) {
            nel_gruppo = true;
            if (vocale == Vocale::forte || vocale == Vocale::debole_accentata) {
                ++nuclei;
            }
        } else {
            // Riusa la stessa definizione di spazio Unicode del core.
            if (trim_unicode(codifica_utf8(std::u32string_view(&carattere, 1))).empty()) {
                return 0;
            }
            if (nel_gruppo) {
                totale += std::max(std::size_t{1}, nuclei);
                nuclei = 0;
                nel_gruppo = false;
            }
        }
    }

    if (nel_gruppo) {
        totale += std::max(std::size_t{1}, nuclei);
    }
    return totale;
}

} // namespace anagrammi
