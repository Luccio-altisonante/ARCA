#include "ordinamento_rimario.hpp"

#include <algorithm>
#include <cstddef>
#include <utility>
#include <vector>

namespace anagrammi {

namespace {

struct VoceRimario {
    std::string originale;
    std::string chiave;
};

bool e_vocale(char carattere) {
    return carattere == 'a' || carattere == 'e' || carattere == 'i' ||
           carattere == 'o' || carattere == 'u';
}

unsigned char byte_at(const std::string& testo, std::ptrdiff_t indice) {
    return static_cast<unsigned char>(testo[static_cast<std::size_t>(indice)]);
}

std::ptrdiff_t ultima_vocale(const std::string& parola) {
    for (std::size_t indice = parola.size(); indice > 0; --indice) {
        if (e_vocale(parola[indice - 1])) {
            return static_cast<std::ptrdiff_t>(indice - 1);
        }
    }
    return -1;
}

std::ptrdiff_t trova_pivot(const std::string& parola, std::ptrdiff_t finale) {
    for (std::ptrdiff_t indice = finale - 2; indice >= 0; --indice) {
        if (e_vocale(parola[static_cast<std::size_t>(indice)])) {
            return indice;
        }
    }
    return -1;
}

int confronta_stringhe(const std::string& sinistra, const std::string& destra) {
    if (sinistra < destra) {
        return -1;
    }
    if (destra < sinistra) {
        return 1;
    }
    return 0;
}

bool voce_rimario_less(const VoceRimario& sinistra, const VoceRimario& destra) {
    std::ptrdiff_t finale_sinistra = ultima_vocale(sinistra.chiave);
    std::ptrdiff_t finale_destra = ultima_vocale(destra.chiave);

    if (finale_sinistra < 0 || finale_destra < 0) {
        if (finale_sinistra < 0 && finale_destra >= 0) {
            return false;
        }
        if (finale_sinistra >= 0 && finale_destra < 0) {
            return true;
        }

        const int confronto_chiavi = confronta_stringhe(sinistra.chiave, destra.chiave);
        if (confronto_chiavi != 0) {
            return confronto_chiavi < 0;
        }
        return sinistra.originale < destra.originale;
    }

    while (true) {
        const unsigned char vocale_sinistra = byte_at(sinistra.chiave, finale_sinistra);
        const unsigned char vocale_destra = byte_at(destra.chiave, finale_destra);
        if (vocale_sinistra != vocale_destra) {
            return vocale_sinistra < vocale_destra;
        }

        const std::ptrdiff_t pivot_sinistra = trova_pivot(sinistra.chiave, finale_sinistra);
        const std::ptrdiff_t pivot_destra = trova_pivot(destra.chiave, finale_destra);

        if (pivot_sinistra < 0 || pivot_destra < 0) {
            if (pivot_sinistra < 0 && pivot_destra >= 0) {
                return true;
            }
            if (pivot_sinistra >= 0 && pivot_destra < 0) {
                return false;
            }

            if (finale_sinistra != finale_destra) {
                return finale_sinistra < finale_destra;
            }
            for (std::ptrdiff_t indice = finale_sinistra - 1; indice >= 0; --indice) {
                const unsigned char carattere_sinistra = byte_at(sinistra.chiave, indice);
                const unsigned char carattere_destra = byte_at(destra.chiave, indice);
                if (carattere_sinistra != carattere_destra) {
                    return carattere_sinistra < carattere_destra;
                }
            }
            break;
        }

        const unsigned char vocale_pivot_sinistra = byte_at(sinistra.chiave, pivot_sinistra);
        const unsigned char vocale_pivot_destra = byte_at(destra.chiave, pivot_destra);
        if (vocale_pivot_sinistra != vocale_pivot_destra) {
            return vocale_pivot_sinistra < vocale_pivot_destra;
        }

        const std::ptrdiff_t gap_sinistra = finale_sinistra - pivot_sinistra - 1;
        const std::ptrdiff_t gap_destra = finale_destra - pivot_destra - 1;
        if (gap_sinistra != gap_destra) {
            return gap_sinistra < gap_destra;
        }

        for (std::ptrdiff_t distanza = 1; distanza <= gap_sinistra; ++distanza) {
            const unsigned char carattere_sinistra =
                byte_at(sinistra.chiave, finale_sinistra - distanza);
            const unsigned char carattere_destra =
                byte_at(destra.chiave, finale_destra - distanza);
            if (carattere_sinistra != carattere_destra) {
                return carattere_sinistra < carattere_destra;
            }
        }

        finale_sinistra = pivot_sinistra;
        finale_destra = pivot_destra;
    }

    const int confronto_chiavi = confronta_stringhe(sinistra.chiave, destra.chiave);
    if (confronto_chiavi != 0) {
        return confronto_chiavi < 0;
    }
    return sinistra.originale < destra.originale;
}

char vocale_accentata_base(unsigned char primo, unsigned char secondo) {
    if (primo != 0xc3) {
        return '\0';
    }

    switch (secondo) {
    case 0x80:
    case 0x81:
    case 0xa0:
    case 0xa1:
        return 'a';
    case 0x88:
    case 0x89:
    case 0xa8:
    case 0xa9:
        return 'e';
    case 0x8c:
    case 0x8d:
    case 0xac:
    case 0xad:
        return 'i';
    case 0x92:
    case 0x93:
    case 0xb2:
    case 0xb3:
        return 'o';
    case 0x99:
    case 0x9a:
    case 0xb9:
    case 0xba:
        return 'u';
    default:
        return '\0';
    }
}

VoceRimario crea_voce(std::string originale) {
    VoceRimario voce;
    voce.chiave = chiave_rimario(originale);
    voce.originale = std::move(originale);
    return voce;
}

} // namespace

std::string chiave_rimario(const std::string& parola) {
    std::string chiave;
    chiave.reserve(parola.size());

    for (std::size_t indice = 0; indice < parola.size(); ++indice) {
        const auto carattere = static_cast<unsigned char>(parola[indice]);
        if (indice + 1 < parola.size()) {
            const char base = vocale_accentata_base(
                carattere, static_cast<unsigned char>(parola[indice + 1]));
            if (base != '\0') {
                chiave.push_back(base);
                ++indice;
                continue;
            }
        }

        if (carattere >= 'A' && carattere <= 'Z') {
            chiave.push_back(static_cast<char>(carattere - 'A' + 'a'));
        } else {
            chiave.push_back(static_cast<char>(carattere));
        }
    }
    return chiave;
}

bool rimario_less(const std::string& sinistra, const std::string& destra) {
    return voce_rimario_less(crea_voce(sinistra), crea_voce(destra));
}

void ordina_rimario(Words& parole) {
    std::vector<VoceRimario> voci;
    voci.reserve(parole.size());
    for (auto& parola : parole) {
        voci.push_back(crea_voce(std::move(parola)));
    }

    std::stable_sort(voci.begin(), voci.end(), voce_rimario_less);

    parole.clear();
    parole.reserve(voci.size());
    for (auto& voce : voci) {
        parole.push_back(std::move(voce.originale));
    }
}

bool e_ordinato_rimario(const Words& parole) {
    return std::is_sorted(parole.begin(), parole.end(), rimario_less);
}

} // namespace anagrammi
