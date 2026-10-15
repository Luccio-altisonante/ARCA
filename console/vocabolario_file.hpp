#ifndef ANAGRAMMI_CONSOLE_VOCABOLARIO_FILE_HPP
#define ANAGRAMMI_CONSOLE_VOCABOLARIO_FILE_HPP

#include "../core/vocabolario.hpp"

#include <string>

namespace anagrammi_console {

anagrammi::Words carica_vocabolario_da_file(const std::string& path);
void salva_vocabolario_su_file(const std::string& path, const anagrammi::Words& words);

} // namespace anagrammi_console

#endif
