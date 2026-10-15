#include "unicode.hpp"

#include "utf8proc.h"

#include <cstdlib>
#include <utility>

namespace anagrammi {

namespace {

constexpr char32_t sostituto_unicode = 0xfffd;

bool e_spazio_ascii(unsigned char carattere) {
    return carattere == 0x20 || (carattere >= 0x09 && carattere <= 0x0d);
}

bool normalizza_ascii(std::string_view testo, std::string& risultato) {
    for (unsigned char carattere : testo) {
        if (carattere >= 0x80) {
            return false;
        }
    }

    std::size_t inizio = 0;
    std::size_t fine = testo.size();
    while (inizio < fine && e_spazio_ascii(static_cast<unsigned char>(testo[inizio]))) {
        ++inizio;
    }
    while (fine > inizio && e_spazio_ascii(static_cast<unsigned char>(testo[fine - 1]))) {
        --fine;
    }

    risultato.assign(testo.substr(inizio, fine - inizio));
    for (char& carattere : risultato) {
        if (carattere >= 'A' && carattere <= 'Z') {
            carattere = static_cast<char>(carattere - 'A' + 'a');
        }
    }
    return true;
}

bool e_spazio(char32_t carattere) {
    if (carattere >= 0x09 && carattere <= 0x0d) {
        return true;
    }

    const auto categoria = utf8proc_category(static_cast<utf8proc_int32_t>(carattere));
    return categoria == UTF8PROC_CATEGORY_ZS || categoria == UTF8PROC_CATEGORY_ZL ||
           categoria == UTF8PROC_CATEGORY_ZP;
}

std::string componi_nfc_valido(const std::string& testo_valido) {
    utf8proc_uint8_t* risultato = nullptr;
    const auto opzioni = static_cast<utf8proc_option_t>(UTF8PROC_STABLE | UTF8PROC_COMPOSE);
    const auto dimensione = utf8proc_map(
        reinterpret_cast<const utf8proc_uint8_t*>(testo_valido.data()),
        static_cast<utf8proc_ssize_t>(testo_valido.size()),
        &risultato,
        opzioni);

    if (dimensione < 0 || risultato == nullptr) {
        std::free(risultato);
        return testo_valido;
    }

    std::string normalizzato(
        reinterpret_cast<const char*>(risultato), static_cast<std::size_t>(dimensione));
    std::free(risultato);
    return normalizzato;
}

std::u32string minuscolo(std::u32string caratteri) {
    for (auto& carattere : caratteri) {
        carattere = static_cast<char32_t>(
            utf8proc_tolower(static_cast<utf8proc_int32_t>(carattere)));
    }
    return caratteri;
}

} // namespace

std::u32string decodifica_utf8(std::string_view testo, bool* valido) {
    std::u32string caratteri;
    caratteri.reserve(testo.size());
    bool input_valido = true;

    std::size_t posizione = 0;
    while (posizione < testo.size()) {
        utf8proc_int32_t carattere = 0;
        const auto dimensione = utf8proc_iterate(
            reinterpret_cast<const utf8proc_uint8_t*>(testo.data() + posizione),
            static_cast<utf8proc_ssize_t>(testo.size() - posizione),
            &carattere);

        if (dimensione <= 0) {
            input_valido = false;
            caratteri.push_back(sostituto_unicode);
            ++posizione;
            continue;
        }

        caratteri.push_back(static_cast<char32_t>(carattere));
        posizione += static_cast<std::size_t>(dimensione);
    }

    if (valido != nullptr) {
        *valido = input_valido;
    }
    return caratteri;
}

std::string codifica_utf8(std::u32string_view testo) {
    std::string risultato;
    risultato.reserve(testo.size());

    for (char32_t carattere : testo) {
        utf8proc_uint8_t buffer[4] = {};
        auto dimensione = utf8proc_encode_char(static_cast<utf8proc_int32_t>(carattere), buffer);
        if (dimensione <= 0) {
            dimensione = utf8proc_encode_char(
                static_cast<utf8proc_int32_t>(sostituto_unicode), buffer);
        }
        risultato.append(
            reinterpret_cast<const char*>(buffer), static_cast<std::size_t>(dimensione));
    }
    return risultato;
}

bool utf8_valido(std::string_view testo) {
    bool valido = false;
    decodifica_utf8(testo, &valido);
    return valido;
}

std::size_t lunghezza_utf8(std::string_view testo) {
    return decodifica_utf8(testo).size();
}

std::string trim_unicode(std::string_view testo) {
    const std::u32string caratteri = decodifica_utf8(testo);
    std::size_t inizio = 0;
    std::size_t fine = caratteri.size();
    while (inizio < fine && e_spazio(caratteri[inizio])) {
        ++inizio;
    }
    while (fine > inizio && e_spazio(caratteri[fine - 1])) {
        --fine;
    }
    return codifica_utf8(std::u32string_view(caratteri).substr(inizio, fine - inizio));
}

std::string normalizza_nfc(std::string_view testo) {
    return componi_nfc_valido(codifica_utf8(decodifica_utf8(testo)));
}

std::string minuscolo_unicode(std::string_view testo) {
    return codifica_utf8(minuscolo(decodifica_utf8(testo)));
}

std::string normalizza_unicode(std::string_view testo) {
    std::string risultato_ascii;
    if (normalizza_ascii(testo, risultato_ascii)) {
        return risultato_ascii;
    }

    std::u32string caratteri = decodifica_utf8(testo);
    std::size_t inizio = 0;
    std::size_t fine = caratteri.size();
    while (inizio < fine && e_spazio(caratteri[inizio])) {
        ++inizio;
    }
    while (fine > inizio && e_spazio(caratteri[fine - 1])) {
        --fine;
    }

    std::u32string ritagliato(caratteri.begin() + static_cast<std::ptrdiff_t>(inizio),
                             caratteri.begin() + static_cast<std::ptrdiff_t>(fine));
    return componi_nfc_valido(codifica_utf8(minuscolo(std::move(ritagliato))));
}

} // namespace anagrammi
