<?php
/**
 * Minimal, dependency-free .xlsx reader (ZipArchive + XMLReader).
 * Returns cell values by sheet as zero-indexed row/column arrays.
 */
class PP_Xlsx_Reader {

	private $zip;
	private $shared = array();
	private $sheets = array(); // name => zip path

	public function __construct( $path ) {
		if ( ! class_exists( 'ZipArchive' ) ) {
			throw new RuntimeException( 'The PHP zip extension is required to read .xlsx files.' );
		}
		$this->zip = new ZipArchive();
		if ( true !== $this->zip->open( $path ) ) {
			throw new RuntimeException( 'Cannot open workbook: ' . $path );
		}
		$this->load_sheets();
		$this->load_shared_strings();
	}

	public function sheet_names() {
		return array_keys( $this->sheets );
	}

	private function load_sheets() {
		$wb = $this->zip->getFromName( 'xl/workbook.xml' );
		$rl = $this->zip->getFromName( 'xl/_rels/workbook.xml.rels' );
		if ( ! $wb || ! $rl ) {
			throw new RuntimeException( 'Invalid workbook (missing workbook.xml).' );
		}
		$rels = array();
		$x    = simplexml_load_string( $rl );
		foreach ( $x->Relationship as $r ) {
			$target = (string) $r['Target'];
			if ( strpos( $target, '/' ) === 0 ) {
				$target = ltrim( $target, '/' );
			} else {
				$target = 'xl/' . $target;
			}
			$rels[ (string) $r['Id'] ] = $target;
		}
		$x = simplexml_load_string( $wb );
		$x->registerXPathNamespace( 'm', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main' );
		foreach ( $x->xpath( '//m:sheets/m:sheet' ) as $s ) {
			$attrs = $s->attributes( 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' );
			$rid   = (string) $attrs['id'];
			if ( isset( $rels[ $rid ] ) ) {
				$this->sheets[ (string) $s['name'] ] = $rels[ $rid ];
			}
		}
	}

	private function load_shared_strings() {
		$idx = $this->zip->locateName( 'xl/sharedStrings.xml' );
		if ( false === $idx ) {
			return;
		}
		$r = new XMLReader();
		$r->open( 'zip://' . $this->zip->filename . '#xl/sharedStrings.xml' );
		$ok = $r->read();
		while ( $ok ) {
			if ( XMLReader::ELEMENT === $r->nodeType && 'si' === $r->localName ) {
				$node = $r->expand();
				$text = '';
				if ( $node ) {
					foreach ( $node->getElementsByTagName( 't' ) as $t ) {
						if ( $t->parentNode && 'rPh' === $t->parentNode->localName ) {
							continue;
						}
						$text .= $t->textContent;
					}
				}
				$this->shared[] = $text;
				$ok = $r->next();
				continue;
			}
			$ok = $r->read();
		}
		$r->close();
	}

	public static function col_index( $ref ) {
		$letters = preg_replace( '/[^A-Z]/', '', strtoupper( $ref ) );
		$n       = 0;
		$len     = strlen( $letters );
		for ( $i = 0; $i < $len; $i++ ) {
			$n = $n * 26 + ( ord( $letters[ $i ] ) - 64 );
		}
		return $n - 1;
	}

	/**
	 * Read a sheet. Returns array of rows; each row is a zero-indexed array of values
	 * (null for blank cells). Row index = Excel row number - 1.
	 */
	public function rows( $sheet_name, $max_rows = 0 ) {
		if ( ! isset( $this->sheets[ $sheet_name ] ) ) {
			throw new RuntimeException( 'Sheet not found: ' . $sheet_name );
		}
		$path = $this->sheets[ $sheet_name ];
		$r    = new XMLReader();
		$r->open( 'zip://' . $this->zip->filename . '#' . $path );
		$rows = array();
		$maxc = 0;
		$ok   = $r->read();
		while ( $ok ) {
			if ( XMLReader::ELEMENT !== $r->nodeType || 'row' !== $r->localName ) {
				$ok = $r->read();
				continue;
			}
			$rownum = (int) $r->getAttribute( 'r' );
			$node   = $r->expand();
			$cells  = array();
			if ( $node ) {
				foreach ( $node->childNodes as $c ) {
					if ( 'c' !== $c->localName ) {
						continue;
					}
					$ref  = $c->getAttribute( 'r' );
					$type = $c->getAttribute( 't' );
					$ci   = self::col_index( $ref );
					$v    = null;
					$vn   = null;
					foreach ( $c->childNodes as $ch ) {
						if ( 'v' === $ch->localName ) {
							$vn = $ch->textContent;
						} elseif ( 'is' === $ch->localName ) {
							$vn   = $ch->textContent;
							$type = 'inlineStr';
						}
					}
					if ( null === $vn ) {
						continue;
					}
					switch ( $type ) {
						case 's':
							$v = isset( $this->shared[ (int) $vn ] ) ? $this->shared[ (int) $vn ] : '';
							break;
						case 'b':
							$v = (bool) (int) $vn;
							break;
						case 'str':
						case 'inlineStr':
							$v = (string) $vn;
							break;
						case 'e':
							$v = null;
							break;
						default:
							$v = is_numeric( $vn ) ? ( 0 + $vn ) : $vn;
					}
					if ( is_string( $v ) && '' === trim( $v ) ) {
						$v = null;
					}
					if ( null !== $v ) {
						$cells[ $ci ] = $v;
						if ( $ci > $maxc ) {
							$maxc = $ci;
						}
					}
				}
			}
			if ( $cells && $rownum > 0 ) {
				$rows[ $rownum - 1 ] = $cells;
			}
			if ( $max_rows && count( $rows ) >= $max_rows ) {
				break;
			}
			$ok = $r->next();
		}
		$r->close();
		// Normalise to dense arrays
		$out    = array();
		$last   = $rows ? max( array_keys( $rows ) ) : -1;
		for ( $i = 0; $i <= $last; $i++ ) {
			$row = array_fill( 0, $maxc + 1, null );
			if ( isset( $rows[ $i ] ) ) {
				foreach ( $rows[ $i ] as $ci => $v ) {
					$row[ $ci ] = $v;
				}
			}
			$out[ $i ] = $row;
		}
		return $out;
	}
}
