<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Minimal, dependency free XLSX reader (values only, streaming).
 * Returns rows as arrays keyed by 1-based column number containing only non-empty cells.
 */
class JMG_Xlsx_Reader {
	private $zip;
	private $path;
	private $shared = array();
	private $sheets = array(); // name => zip path

	public function __construct( $path ) {
		if ( ! class_exists( 'ZipArchive' ) ) {
			throw new Exception( 'PHP ZipArchive extension is required to read Excel files.' );
		}
		$this->path = $path;
		$this->zip = new ZipArchive();
		if ( true !== $this->zip->open( $path ) ) {
			throw new Exception( 'Unable to open workbook: ' . basename( $path ) );
		}
		$this->load_shared_strings();
		$this->load_sheet_index();
	}

	public function sheet_names() {
		return array_keys( $this->sheets );
	}

	public function has_sheet( $name ) {
		return isset( $this->sheets[ $this->norm( $name ) ] );
	}

	private function norm( $name ) {
		return strtolower( preg_replace( '/\s+/', '', (string) $name ) );
	}

	private function load_shared_strings() {
		$xml = $this->zip->getFromName( 'xl/sharedStrings.xml' );
		if ( false === $xml ) { return; }
		$reader = new XMLReader();
		$reader->XML( $xml );
		$ok = $reader->read();
		while ( $ok ) {
			if ( XMLReader::ELEMENT === $reader->nodeType && 'si' === $reader->localName ) {
				$node = $reader->expand();
				$this->shared[] = $this->text_of( $node );
				$ok = $reader->next();
				continue;
			}
			$ok = $reader->read();
		}
		$reader->close();
	}

	private function text_of( $node ) {
		$out = '';
		if ( $node->nodeType === XML_TEXT_NODE ) { return $node->nodeValue; }
		foreach ( $node->childNodes as $child ) {
			if ( 'rPh' === $child->localName ) { continue; }
			if ( 't' === $child->localName ) { $out .= $child->nodeValue; } else { $out .= $this->text_of( $child ); }
		}
		return $out;
	}

	private function load_sheet_index() {
		$wb = $this->zip->getFromName( 'xl/workbook.xml' );
		$rels = $this->zip->getFromName( 'xl/_rels/workbook.xml.rels' );
		if ( false === $wb || false === $rels ) { throw new Exception( 'Workbook index not found.' ); }
		$relmap = array();
		$rx = simplexml_load_string( $rels );
		foreach ( $rx->Relationship as $r ) {
			$target = (string) $r['Target'];
			if ( 0 === strpos( $target, '/' ) ) { $target = ltrim( $target, '/' ); } else { $target = 'xl/' . $target; }
			$relmap[ (string) $r['Id'] ] = $target;
		}
		$wx = simplexml_load_string( $wb );
		$wx->registerXPathNamespace( 'm', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main' );
		foreach ( $wx->sheets->sheet as $s ) {
			$ns = $s->attributes( 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' );
			$rid = (string) $ns['id'];
			$name = (string) $s['name'];
			if ( isset( $relmap[ $rid ] ) ) { $this->sheets[ $this->norm( $name ) ] = array( 'name' => $name, 'path' => $relmap[ $rid ] ); }
		}
	}

	/**
	 * Read a sheet. Returns array( rowNumber => array( colNumber => value ) ).
	 * @param string   $name     Sheet name (whitespace/case insensitive).
	 * @param int|null $max_col  Ignore columns beyond this index.
	 * @param int|null $max_row  Stop after this row.
	 */
	public function rows( $name, $max_col = null, $max_row = null ) {
		$key = $this->norm( $name );
		if ( ! isset( $this->sheets[ $key ] ) ) { throw new Exception( 'Sheet not found: ' . $name ); }
		$xml = $this->zip->getFromName( $this->sheets[ $key ]['path'] );
		if ( false === $xml ) { throw new Exception( 'Sheet data missing: ' . $name ); }
		$reader = new XMLReader();
		$reader->XML( $xml );
		$rows = array();
		$ok = $reader->read();
		while ( $ok ) {
			if ( XMLReader::ELEMENT !== $reader->nodeType || 'row' !== $reader->localName ) { $ok = $reader->read(); continue; }
			$rnum = (int) $reader->getAttribute( 'r' );
			if ( $max_row && $rnum > $max_row ) { break; }
			$node = $reader->expand();
			$row = array();
			$col_counter = 0;
			foreach ( $node->childNodes as $c ) {
				if ( 'c' !== $c->localName ) { continue; }
				$ref = $c->getAttribute( 'r' );
				$col = $ref ? $this->col_index( preg_replace( '/\d+/', '', $ref ) ) : ( $col_counter + 1 );
				$col_counter = $col;
				if ( $max_col && $col > $max_col ) { continue; }
				$type = $c->getAttribute( 't' );
				$v = null;
				foreach ( $c->childNodes as $cc ) {
					if ( 'v' === $cc->localName ) { $v = $cc->nodeValue; }
					elseif ( 'is' === $cc->localName ) { $v = $this->text_of( $cc ); $type = 'inlineStr'; }
				}
				if ( null === $v ) { continue; }
				if ( 's' === $type ) { $v = isset( $this->shared[ (int) $v ] ) ? $this->shared[ (int) $v ] : ''; }
				elseif ( 'b' === $type ) { $v = (bool) $v; }
				elseif ( 'inlineStr' === $type || 'str' === $type ) { $v = (string) $v; }
				elseif ( 'e' === $type ) { $v = null; }
				else { $v = is_numeric( $v ) ? $v + 0 : $v; }
				if ( null === $v || '' === $v ) { continue; }
				$row[ $col ] = $v;
			}
			if ( $row ) { $rows[ $rnum ] = $row; }
			$ok = $reader->next();
		}
		$reader->close();
		return $rows;
	}

	private function col_index( $letters ) {
		$n = 0;
		$letters = strtoupper( $letters );
		for ( $i = 0; $i < strlen( $letters ); $i++ ) {
			$n = $n * 26 + ( ord( $letters[ $i ] ) - 64 );
		}
		return $n;
	}

	public function close() {
		if ( $this->zip ) { $this->zip->close(); $this->zip = null; }
	}
}
